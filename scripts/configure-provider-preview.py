#!/usr/bin/env python3
"""Stage private provider/rotation configuration on Vercel PREVIEW only. Never prints values."""
import argparse, json, os, re, urllib.request
from pathlib import Path

def read_env(file):
    return {k:v.strip().strip('"\'') for line in file.read_text().splitlines() if '=' in line and not line.lstrip().startswith('#') for k,v in [line.split('=',1)]}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file',type=Path)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--project-id',default=os.getenv('VERCEL_PROJECT_ID'))
    parser.add_argument('--team-id',default=os.getenv('VERCEL_TEAM_ID'))
    args=parser.parse_args()
    if args.file.stat().st_mode & 0o077:raise RuntimeError('Private file must have permission 600')
    fields=read_env(args.file)
    allowed={f'{p}_{suffix}' for p in ['INSTAGRAM','TIKTOK','X','YOUTUBE'] for suffix in ['CLIENT_ID','CLIENT_SECRET']}
    allowed|={'TIKTOK_APP_AUDITED','YOUTUBE_PROJECT_AUDITED','BEEHIIV_POSTS_ACCESS_VERIFIED','PRODUCTION_WORKER_TOKEN','PRODUCTION_WORKER_TOKEN_PREVIOUS','PRODUCTION_WORKER_TOKEN_PREVIOUS_UNTIL','INTEGRATION_ENCRYPTION_KEY','INTEGRATION_ENCRYPTION_KEY_PREVIOUS'}
    if not fields or set(fields)-allowed:raise RuntimeError('Unknown or empty configuration field; publication/spend flags cannot be enabled by this command')
    if any(not v for v in fields.values()):raise RuntimeError('Empty private configuration value')
    if 'INTEGRATION_ENCRYPTION_KEY' in fields:
        old=read_env(Path('.env.local')).get('INTEGRATION_ENCRYPTION_KEY')
        if fields.get('INTEGRATION_ENCRYPTION_KEY_PREVIOUS')!=old or not re.fullmatch('[a-fA-F0-9]{64}',fields['INTEGRATION_ENCRYPTION_KEY']):raise RuntimeError('Encryption rotation requires the exact current key as previous, and a valid new key')
    if not args.project_id:raise RuntimeError('Pass dedicated --project-id and --team-id; never infer another project')
    print('Validated PREVIEW configuration field names:',', '.join(sorted(fields)))
    if not args.apply:return
    token=os.getenv('VERCEL_TOKEN') or read_env(Path.home()/'.env.infrastructure.local').get('VERCEL_TOKEN')
    if not token:raise RuntimeError('Private Vercel authorization required')
    url=f'https://api.vercel.com/v10/projects/{args.project_id}/env?upsert=true'+(f'&teamId={args.team_id}' if args.team_id else '')
    data=[{'key':k,'value':v,'target':['preview'],'type':'encrypted'} for k,v in fields.items()]
    request=urllib.request.Request(url,data=json.dumps(data).encode(),method='POST',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=60) as response:
        if response.status not in (200,201):raise RuntimeError('Preview configuration rejected; values not logged')
    print('Encrypted PREVIEW values staged. Redeploy preview before runtime verification. No production settings changed.')
if __name__=='__main__':
    try:main()
    except Exception as e:
        print('Configuration failed:',type(e).__name__,str(e) if isinstance(e,RuntimeError) else 'No secret/request/response logged')
        raise SystemExit(1)
