#!/usr/bin/env python3
"""Core-only image replacement. No database writes, builds, provisioning or remote access."""
import argparse, contextlib, fcntl, json, os, pathlib, re, signal, stat, subprocess, sys, tempfile, time
SHA=re.compile(r'[0-9a-f]{40}\Z'); IMAGE=re.compile(r'sha256:[0-9a-f]{64}\Z')
class Refused(Exception): pass

def require(ok, code):
    if not ok: raise Refused(code)

def atomic(path, value):
    data=json.dumps(value,sort_keys=True).encode()+b'\n'
    fd,name=tempfile.mkstemp(prefix='.phase-',dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'wb') as f: f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(name,path)
        directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(name):os.unlink(name)

def metadata(path):
    path=pathlib.Path(path)
    require(path.is_absolute(),'config_path')
    info=path.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode)==0o600 and info.st_uid==os.getuid(),'config_metadata')
    return dict(device=info.st_dev,inode=info.st_ino,uid=info.st_uid,gid=info.st_gid,mode=stat.S_IMODE(info.st_mode),size=info.st_size,mtime=info.st_mtime_ns)

class Upgrade:
    def __init__(self,a):
        self.a=a;self.phase='preflight';self.stopped=False;self.restoring=False;self.anchor=None;self.run=None;self.lock=None
        self.env=dict(os.environ,CORE_ENV_FILE=a.core_config,ADMIN_ENV_FILE=a.compose_config,FRONT_DOT_SHA=a.sha or 'image-only')
        self.end=time.monotonic()+a.timeout
        self.base=['docker','compose','--env-file',a.compose_config,'-p','front-dot','-f',str(pathlib.Path(a.compose).resolve())]
    def command(self,args,input=None):
        remaining=min(30,self.end-time.monotonic())
        require(remaining>0,'timeout')
        try:
            p=subprocess.run(args,input=input,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=self.env,timeout=remaining)
        except subprocess.TimeoutExpired:raise Refused('command_timeout')
        require(p.returncode==0,'command_failed')
        return p.stdout.strip()
    def compose(self,*args):return self.command(self.base+list(args))
    def inspect(self,kind,identity,fields):
        # Select metadata in the Docker API itself. Never request Config.Env or raw inspect.
        fmt='{'+','.join(json.dumps(k)+':{{json '+v+'}}' for k,v in fields.items())+'}'
        return json.loads(self.command(['docker',kind,'inspect','--format',fmt,identity]))
    def container(self,cid):
        return self.inspect('container',cid,dict(id='.Id',image='.Image',tag='.Config.Image',running='.State.Running',health='.State.Health.Status',mounts='.Mounts'))
    def image(self,tag):
        return self.inspect('image',tag,dict(id='.Id',revision='(index .Config.Labels "org.opencontainers.image.revision")',tree='(index .Config.Labels "org.opencontainers.image.source-tree")'))
    def ids(self,service,running=False):
        args=['ps','--all','-q',service] if not running else ['ps','--status','running','-q',service]
        return self.compose(*args).split()
    def config(self):return {k:metadata(v) for k,v in [('core',self.a.core_config),('compose',self.a.compose_config)]}
    def pg(self):
        ids=self.ids('pg');require(len(ids)==1,'pg_count')
        pg=self.container(ids[0]);require(pg['running'] and pg['health']=='healthy','pg_health')
        mounts=[m for m in pg['mounts'] if m.get('Destination')=='/var/lib/postgresql/data']
        require(len(mounts)==1 and mounts[0].get('Type')=='volume','pg_volume')
        volume=self.inspect('volume',mounts[0]['Name'],dict(name='.Name',driver='.Driver',created='.CreatedAt',mountpoint='.Mountpoint'))
        return dict(id=pg['id'],image=pg['image'],tag=pg['tag'],mount=mounts[0],volume=volume)
    def sql(self,sql):
        # psql uses the already-running PG container's local socket; no credentials are read.
        text=self.command(['docker','exec','-i',self.anchor['pg']['id'],'psql','-X','-w','-U','postgres','-d','front_dot','-v','ON_ERROR_STOP=1','-At'],
            'BEGIN READ ONLY;\nSET LOCAL statement_timeout=\'5000ms\';\n'+sql+'\nCOMMIT;\n')
        lines=[s for s in text.splitlines() if s.startswith('{')]
        require(len(lines)==1,'sql_result')
        return json.loads(lines[0])
    def snapshot(self):
        return self.sql("""SELECT json_build_object(
 'schema',(SELECT json_agg(json_build_array(version,checksum) ORDER BY version) FROM front_claw_perf.schema_migrations),
 'entries',(SELECT count(*) FROM front_claw_perf.performance_entries),
 'drafts',(SELECT count(*) FROM front_claw_perf.performance_drafts),
 'notifications',(SELECT count(*) FROM front_claw_perf.performance_notifications),
 'accounts',(SELECT count(*) FROM front_claw_perf.performance_people),
 'bindings',(SELECT count(*) FROM front_claw_perf.wecom_bot_bindings),
 'roles',(SELECT count(*) FROM pg_roles),
 'config',(SELECT count(*) FROM front_claw_perf.performance_config));""")
    def lease(self):
        value=self.sql("""SELECT json_build_object('lease', CASE
 WHEN count(*)<>1 THEN 'invalid'
 WHEN bool_and((value::jsonb->>'epoch') ~ '^[0-9]+$' AND (value::jsonb->>'until') ~ '^[0-9]+$'
   AND jsonb_typeof(value::jsonb->'owner') IN ('string','null') AND jsonb_typeof(value::jsonb->'token') IN ('string','null'))
 THEN CASE WHEN max((value::jsonb->>'until')::numeric) <= extract(epoch FROM clock_timestamp())*1000 THEN 'free'
 WHEN bool_and(jsonb_typeof(value::jsonb->'owner')='string' AND jsonb_typeof(value::jsonb->'token')='string') THEN 'active' ELSE 'invalid' END
 ELSE 'invalid' END,'epoch',max((value::jsonb->>'epoch')::bigint))
 FROM front_claw_perf.performance_config WHERE key='front-claw-opendot-consumer';""")
        require(value.get('lease') in ['free','active'] and isinstance(value.get('epoch'),int),'lease_unknown')
        return value
    def wait(self,check):
        deadline=min(self.end,time.monotonic()+self.a.wait)
        while True:
            if check():return
            require(time.monotonic()<deadline,'wait_timeout')
            time.sleep(0.1)
    def phase_to(self,name):
        self.phase=name
        if self.run:atomic(self.run/'phase.json',dict(phase=name))
    def check_anchor(self):
        require(self.pg()==self.anchor['pg'],'pg_anchor_changed')
        require(self.config()==self.anchor['config'],'config_changed')
    def absent(self):
        require(not self.ids('core',True),'consumer_present')
    def quiescent(self):
        self.absent()
        return self.lease()['lease']=='free'
    def start(self,image):
        self.absent();self.check_anchor()
        require(self.lease()['lease']=='free','lease_not_free')
        require(IMAGE.fullmatch(image) and self.image(image)['id']==image,'immutable_image_missing')
        # Override only the core image. Compose normally consumes the original config paths.
        override=self.run/'core-image.json';atomic(override,{'services':{'core':{'image':image}}})
        self.command(self.base+['-f',str(override),'up','-d','--no-deps','--no-build','--pull','never','--scale','core=1','core'])
        def healthy():
            ids=self.ids('core',True)
            require(len(ids)<=1,'multiple_consumers')
            if not ids:return False
            c=self.container(ids[0]);require(c['image']==image,'running_image_mismatch')
            return c['health']=='healthy' and self.lease()['lease']=='active'
        self.wait(healthy);self.check_anchor()
    def verify_data(self):
        after=self.snapshot();before=self.anchor['data']
        require(after.get('schema')==before['schema'],'schema_changed')
        for k in ['entries','drafts','notifications','accounts','bindings','roles','config']:
            require(isinstance(after.get(k),int) and after[k]>=before[k],'data_count_decreased')
        # Normal business additions are allowed. No amount monotonicity assumption.
        return after
    def restore(self):
        self.restoring=True
        self.phase_to('rollback_stop');self.compose('stop','core');self.absent()
        self.phase_to('rollback_lease');self.wait(self.quiescent)
        self.check_anchor()
        # Never resolve the old tag for execution: restart this run's immutable ID only.
        self.phase_to('rollback_start');self.start(self.anchor['old']['image'])
        self.phase_to('rollback_verify');self.verify_data();self.phase_to('rolled_back')
    def execute(self):
        os.umask(0o077)
        root=pathlib.Path(self.a.deploy_dir);require(root.is_absolute() and root.is_dir(),'deploy_directory')
        require(not root.is_symlink() and root.stat().st_uid==os.getuid() and stat.S_IMODE(root.stat().st_mode)==0o700,'deploy_metadata')
        # Do not replace/unlink this file: all image and legacy deployment entry points share its inode.
        lockfd=os.open(root/'deploy.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        self.lock=os.fdopen(lockfd,'r+')
        lock=self.lock
        require(stat.S_ISREG(os.fstat(lock.fileno()).st_mode),'lock_metadata')
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Refused('deployment_busy')
        self.run=pathlib.Path(tempfile.mkdtemp(prefix='image-run-',dir=root));os.chmod(self.run,0o700)
        parentfd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(parentfd)
        finally:os.close(parentfd)
        self.phase_to('preflight')
        if self.a.rollback_run:
            previous=pathlib.Path(self.a.rollback_run).resolve()
            require(previous.parent==root.resolve() and previous!=self.run,'rollback_run_path')
            require(stat.S_IMODE(previous.stat().st_mode)==0o700 and previous.stat().st_uid==os.getuid(),'rollback_run_metadata')
            self.anchor=json.loads((previous/'anchor.json').read_text())
            self.check_anchor();self.phase_to('rollback_anchor');atomic(self.run/'anchor.json',self.anchor)
            self.stopped=True;self.restore();return
        require(SHA.fullmatch(self.a.sha or '') and SHA.fullmatch(self.a.tree or ''),'target_required')
        require(self.command(['git','rev-parse',self.a.sha+'^{commit}'])==self.a.sha,'target_commit')
        require(self.command(['git','rev-parse',self.a.sha+'^{tree}'])==self.a.tree,'target_tree')
        manifest=json.loads(pathlib.Path(self.a.manifest).read_text())
        target=self.image(self.a.image)
        require(IMAGE.fullmatch(target['id']) and manifest==dict(commit=self.a.sha,tree=self.a.tree,image=target['id'])
            and target['revision']==self.a.sha and target['tree']==self.a.tree,'target_provenance')
        config=self.config()
        ids=self.ids('core',True);require(len(ids)==1,'consumer_count')
        old=self.container(ids[0]);require(old['running'] and old['health']=='healthy' and IMAGE.fullmatch(old['image']),'old_unhealthy')
        # Legacy fallback is an explicit tag->running ID anchor, never invented provenance.
        require(bool(old['tag']) and self.image(old['tag'])['id']==old['image'],'old_tag_drift')
        self.anchor=dict(old=old,pg=self.pg(),config=config,target=target)
        data=self.snapshot();schema=data.get('schema')
        require(isinstance(schema,list) and [r[0] for r in schema]==[7,8,9,10,11]
            and all(isinstance(r[1],str) and re.fullmatch('[0-9a-f]{64}',r[1]) for r in schema),'schema_checksums')
        # Check the on-disk reviewed checksum manifest, not just schema version.
        expected=json.loads(pathlib.Path(self.a.schema_manifest).read_text())
        require(schema==expected,'schema_checksum_mismatch')
        self.anchor['data']=data;self.anchor['lease']=self.lease()
        self.phase_to('anchor');atomic(self.run/'anchor.json',self.anchor)
        self.check_anchor()
        require(self.image(old['tag'])['id']==old['image'],'old_tag_drift')
        self.phase_to('stop_old');self.stopped=True;self.compose('stop','core');self.absent()
        self.phase_to('lease_release');self.wait(self.quiescent)
        self.phase_to('start_new');self.start(target['id'])
        require(self.lease()['epoch']>self.anchor['lease']['epoch'],'lease_epoch')
        self.phase_to('verify');self.verify_data();self.phase_to('complete')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for k in ['deploy-dir','core-config','compose-config','manifest','schema-manifest','sha','tree','image','rollback-run']:
        parser.add_argument('--'+k,required=k in ['deploy-dir','core-config','compose-config'])
    parser.add_argument('--compose',default='deploy/compose.json')
    parser.add_argument('--timeout',type=float,default=180);parser.add_argument('--wait',type=float,default=45)
    a=parser.parse_args();require(0<a.timeout<=600 and 0<a.wait<=90,'invalid_timeout')
    task=Upgrade(a)
    def interrupted(*_):raise Refused('signal')
    for sig in [signal.SIGTERM,signal.SIGINT]:signal.signal(sig,interrupted)
    try:task.execute()
    except (Exception,KeyboardInterrupt) as error:
        failed=task.phase
        category=str(error) if isinstance(error,Refused) else 'operation_failed'
        if task.stopped and task.anchor and not task.restoring:
            # A failed/expired request gets a separate bounded recovery budget.
            task.end=time.monotonic()+min(a.timeout,180)
            try:task.restore()
            except (Exception,KeyboardInterrupt):
                with contextlib.suppress(Exception):task.phase_to('rollback_failed')
                print(json.dumps(dict(exit=2,phase='rollback_failed',failedPhase=failed,category=category)));return 2
        if task.restoring and task.phase!='rolled_back':
            with contextlib.suppress(Exception):task.phase_to('rollback_failed')
        print(json.dumps(dict(exit=1,phase=task.phase,failedPhase=failed,category=category)));return 1
    print(json.dumps(dict(exit=0,phase=task.phase)));return 0
if __name__=='__main__':sys.exit(main())
