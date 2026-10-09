"""Dedicated spare-Mac supervisor. No inbound listener; no Codex credentials copied."""
import argparse,fcntl,json,os,pathlib,plistlib,shutil,signal,subprocess,sys,time
ROOT=pathlib.Path.home()/"Library/Application Support/BrainOS/newsroom"
LABEL="com.brainos.newsroom"
PLIST=pathlib.Path.home()/f"Library/LaunchAgents/{LABEL}.plist"
def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['install','start','stop','status','run']);p.add_argument('--config');a=p.parse_args()
 target=f'gui/{os.getuid()}'
 if a.action=='install':
  if not a.config:raise SystemExit('--config private JSON required; see docs/autonomous-newsroom.md')
  cfg=json.loads(pathlib.Path(a.config).read_text())
  for k in ['node','codex','origin','worker_token']:
   if not cfg.get(k):raise SystemExit('Missing config: '+k)
  if not cfg['origin'].startswith('https://'):raise SystemExit('HTTPS origin required')
  for k in ['node','codex']:
   if not pathlib.Path(cfg[k]).is_file():raise SystemExit('Missing executable: '+k)
  # The spare must have its own normal ChatGPT CLI login, never the main Mac's copied auth.
  check=subprocess.run([cfg['codex'],'login','status'],capture_output=True,text=True)
  if check.returncode or 'ChatGPT' not in check.stdout+check.stderr:raise SystemExit('Run codex login on this Mac using ChatGPT first')
  repo=pathlib.Path(__file__).resolve().parents[2];ROOT.mkdir(parents=True,exist_ok=True)
  for folder in ['src','scripts/newsroom','node_modules']:
   shutil.copytree(repo/folder,ROOT/folder,dirs_exist_ok=True,symlinks=False)
  shutil.copy2(repo/'package.json',ROOT/'package.json')
  private=ROOT/'config.json';private.write_text(json.dumps(cfg));private.chmod(0o600)
  PLIST.parent.mkdir(parents=True,exist_ok=True)
  PLIST.write_bytes(plistlib.dumps({'Label':LABEL,'ProgramArguments':[sys.executable,str(ROOT/'scripts/newsroom/service.py'),'run'],'WorkingDirectory':str(ROOT),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':60,'StandardOutPath':str(ROOT/'service.log'),'StandardErrorPath':str(ROOT/'service.log')}))
  print('Installed. Start with service.py start; keep the spare awake and powered.');return
 if a.action=='start':subprocess.run(['launchctl','bootstrap',target,str(PLIST)],check=True);return
 if a.action=='stop':subprocess.run(['launchctl','bootout',target+'/'+LABEL],check=False);return
 if a.action=='status':subprocess.run(['launchctl','print',target+'/'+LABEL],check=False);return
 ROOT.mkdir(parents=True,exist_ok=True);lock=open(ROOT/'worker.lock','w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:raise SystemExit('Worker already running')
 cfg=json.loads((ROOT/'config.json').read_text());env={k:v for k,v in os.environ.items() if k in ['HOME','PATH','TMPDIR','LANG']}
 env.update({'BRAINOS_ORIGIN':cfg['origin'],'PRODUCTION_WORKER_TOKEN':cfg['worker_token'],'NEWSROOM_CODEX_BIN':cfg['codex'],'NEWSROOM_WORK_DIR':str(ROOT/'jobs')})
 if cfg.get('bypass'):env['VERCEL_AUTOMATION_BYPASS_SECRET']=cfg['bypass']
 while True:
  # Polling is short and sleeping consumes no CPU. Codex/renderer run only for claimed work.
  child=subprocess.Popen([cfg['node'],'--import','./node_modules/tsx/dist/loader.mjs','scripts/newsroom/worker.mjs'],cwd=ROOT,env=env)
  def stop(*_):child.terminate();raise SystemExit(0)
  signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
  code=child.wait();print(json.dumps({'at':time.time(),'worker_exit':code}),flush=True)
  log=ROOT/'service.log'
  if log.exists() and log.stat().st_size>2_000_000:
   # Truncate the same inode used by launchd after retaining one bounded backup.
   shutil.copy2(log,ROOT/'service.previous.log');log.write_text('')
  time.sleep(60 if code==0 else 300)
if __name__=='__main__':main()
