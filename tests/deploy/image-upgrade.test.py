#!/usr/bin/env python3
import fcntl,json,os,pathlib,subprocess,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
class ImageUpgrade(unittest.TestCase):
 def exercise(self,flags=None,changes=None,rollback=False):
  with tempfile.TemporaryDirectory(prefix='image-upgrade-test-') as tmp:
   root=pathlib.Path(tmp);root.chmod(0o700);deploy=root/'deploy';deploy.mkdir(mode=0o700)
   core=root/'synthetic-core';core.write_text('SYNTHETIC=1\n');core.chmod(0o600)
   config=root/'synthetic-compose';config.write_text('SYNTHETIC=1\n');config.chmod(0o600)
   sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
   tree=subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=ROOT,text=True).strip()
   schema=[[v,'a'*64] for v in range(7,12)]
   state=dict(sha=sha,tree=tree,schema=schema,commands=[],sql=[],running=True,image='sha256:'+'1'*64,free=False,epoch=1,entries=1,config=str(core),deploy=str(deploy),accounts=['synthetic-account'],bindings=['synthetic-binding'],configuration=['synthetic-config'],volume='synthetic-volume',**(flags or {}))
   statefile=root/'state.json';statefile.write_text(json.dumps(state))
   manifest=root/'manifest.json';manifest.write_text(json.dumps(dict(commit=sha,tree=tree,image='sha256:'+'2'*64)))
   checks=root/'schema.json';checks.write_text(json.dumps(schema))
   args=['python3',str(ROOT/'scripts/deploy/upgrade-image.py'),'--deploy-dir',str(deploy),'--core-config',str(core),'--compose-config',str(config),'--sha',sha,'--tree',tree,'--image','front-dot:target','--manifest',str(manifest),'--schema-manifest',str(checks),'--wait','0.25','--timeout','5']
   if changes:changes(args,core,manifest,checks)
   env=dict(os.environ,PATH=str(ROOT/'tests/deploy/image-fixtures')+':'+os.environ['PATH'],SYNTHETIC_DOCKER_STATE=str(statefile))
   p=subprocess.run(args,cwd=ROOT,env=env,text=True,capture_output=True,timeout=15)
   report=json.loads(p.stdout);self.assertEqual(p.returncode,report['exit'],p.stderr)
   for run in deploy.glob('image-run-*'):run.chmod(0o700)
   if rollback and p.returncode==0:
    run=next(deploy.glob('image-run-*'))
    r=subprocess.run(['bash',str(ROOT/'scripts/deploy/rollback-image.sh'),*args[2:6], '--compose-config',str(config),'--rollback-run',str(run),'--wait','0.25','--timeout','5'],cwd=ROOT,env=env,text=True,capture_output=True,timeout=15)
    self.assertEqual(r.returncode,0,r.stdout+r.stderr)
   after=json.loads(statefile.read_text());commands=after['commands']
   for key in ['accounts','bindings','configuration','volume']:self.assertEqual(after[key],state[key])
   for command in commands:
    self.assertFalse(set(command)&{'migrate','provision','seed','init','down','build','rm'},command)
    if 'up' in command:
     for token in ['--no-deps','--no-build','--pull','never','--scale','core=1']:self.assertIn(token,command)
     self.assertEqual(command[-1],'core')
   for sql in after['sql']:
    self.assertTrue(sql.startswith('BEGIN READ ONLY;'))
    self.assertNotRegex(sql,r'(?i)\b(?:insert|update|delete|alter|create|drop|truncate)\b')
   self.assertNotIn('SYNTHETIC=1',p.stdout+p.stderr)
   return p.returncode,report,after
 def test_upgrade_and_explicit_rollback_preserve_new_business(self):
  code,report,s=self.exercise(rollback=True);self.assertEqual(code,0);self.assertEqual(s['entries'],2);self.assertEqual(s['image'],'sha256:'+'1'*64)
 def test_upgrade(self):
  code,report,s=self.exercise();self.assertEqual(code,0);self.assertEqual(report['phase'],'complete');self.assertEqual(s['entries'],2)
 def test_signal_rolls_back(self):
  code,r,s=self.exercise(dict(signalOnStart=True));self.assertEqual(code,1);self.assertEqual(r['phase'],'rolled_back');self.assertEqual(s['entries'],2)
 def test_anchor_write_failure_does_not_stop(self):
  code,r,s=self.exercise(dict(anchorWriteFail=True));self.assertEqual(code,1);self.assertFalse(any('stop' in c for c in s['commands']))
 def test_target_provenance_mismatch(self):self.assertEqual(self.exercise(dict(badProvenance=True))[0],1)
 def test_missing_target(self):
  self.assertEqual(self.exercise(changes=lambda a,*_:a.__setitem__(a.index('--sha')+1,''))[0],1)
 def test_old_manifest_not_required(self):self.assertEqual(self.exercise()[0],0)
 def test_bad_target_tree(self):
  self.assertEqual(self.exercise(changes=lambda a,*_:a.__setitem__(a.index('--tree')+1,'f'*40))[0],1)
 def test_manifest_mismatch(self):
  self.assertEqual(self.exercise(changes=lambda a,c,m,k:m.write_text('{}'))[0],1)
 def test_config_mode(self):
  self.assertEqual(self.exercise(changes=lambda a,c,*_:c.chmod(0o644))[0],1)
 def test_checksums(self):
  self.assertEqual(self.exercise(changes=lambda a,c,m,k:k.write_text('[]'))[0],1)
 def test_tag_drift(self):self.assertEqual(self.exercise(dict(tagDrift=True))[0],1)
 def test_multiple_consumers(self):self.assertEqual(self.exercise(dict(multiple=True))[0],1)
 def test_unknown_lease(self):self.assertEqual(self.exercise(dict(unknownLease=True))[0],1)
 def test_pg_anchor_change_blocks_both_starts(self):
  code,r,s=self.exercise(dict(pgDriftOnStop=True));self.assertEqual(code,2);self.assertEqual(r['phase'],'rollback_failed');self.assertFalse(any('up' in c for c in s['commands']))
 def test_config_change_blocks_start(self):self.assertEqual(self.exercise(dict(configDriftOnStop=True))[0],2)
 def test_failed_start_rolls_back_exact_image(self):
  code,r,s=self.exercise(dict(failStart=True));self.assertEqual(code,1);self.assertEqual(r['phase'],'rolled_back');self.assertEqual(s['image'],'sha256:'+'1'*64)
 def test_health_timeout_rolls_back_without_data_restore(self):
  code,r,s=self.exercise(dict(unhealthy=True));self.assertEqual(code,1);self.assertEqual(r['phase'],'rolled_back');self.assertEqual(s['entries'],2)
 def test_rollback_failure(self):
  code,r,s=self.exercise(dict(failStart=True,failRollback=True));self.assertEqual(code,2);self.assertEqual(r['phase'],'rollback_failed')
 def test_lease_timeout(self):self.assertNotEqual(self.exercise(dict(stuckLease=True))[0],0)
 def test_lock_same_inode(self):
  def hold(a,*_):
   self.lock=open(pathlib.Path(a[a.index('--deploy-dir')+1])/'deploy.lock','w');fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:self.assertEqual(self.exercise(changes=hold)[1]['category'],'deployment_busy')
  finally:self.lock.close()
if __name__=='__main__':unittest.main()
