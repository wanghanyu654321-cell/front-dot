#!/usr/bin/env python3
"""Build only a committed Git archive; record immutable local image provenance."""
import argparse, json, pathlib, re, subprocess, tarfile, tempfile
p=argparse.ArgumentParser();p.add_argument('--sha',required=True);p.add_argument('--tree',required=True);p.add_argument('--manifest',required=True);a=p.parse_args()
assert re.fullmatch('[0-9a-f]{40}',a.sha) and re.fullmatch('[0-9a-f]{40}',a.tree)
def run(args):return subprocess.check_output(args,text=True).strip()
assert run(['git','rev-parse',a.sha+'^{commit}'])==a.sha
assert run(['git','rev-parse',a.sha+'^{tree}'])==a.tree
with tempfile.TemporaryDirectory(prefix='committed-image-') as tmp:
 root=pathlib.Path(tmp)
 archive=root/'source.tar'
 with archive.open('wb') as f:
  subprocess.run(['git','archive',a.sha,'src','config','migrations','scripts/e2e','deploy/Dockerfile','package.json','package-lock.json','tsconfig.json','tsconfig.build.json','.dockerignore'],stdout=f,check=True)
 with tarfile.open(archive) as tar:tar.extractall(root/'source',filter='data')
 subprocess.run(['docker','build','--pull=false','--label','org.opencontainers.image.revision='+a.sha,
  '--label','org.opencontainers.image.source-tree='+a.tree,'-t','front-dot:'+a.sha,'-f',str(root/'source/deploy/Dockerfile'),str(root/'source')],check=True)
 image=run(['docker','image','inspect','--format','{{.Id}}','front-dot:'+a.sha])
 assert re.fullmatch('sha256:[0-9a-f]{64}',image)
 # This is public build metadata only, with no environment values.
 pathlib.Path(a.manifest).write_text(json.dumps(dict(commit=a.sha,tree=a.tree,image=image))+'\n')
