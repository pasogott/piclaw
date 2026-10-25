import {expect,test} from 'bun:test';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {formatBytes} from '../../web/static/visual/frontend/src/utils/format';
const root=resolve(import.meta.dir,'../..');

test('Visual workspace consumers use the retained formatter without the deprecated shim',()=>{
  for(const [bytes,expected] of [[0,'0 B'],[1023,'1023 B'],[1024,'1.0 KB'],[1048576,'1.0 MB'],[1073741824,'1.0 GB']] as const)expect(formatBytes(bytes)).toBe(expected);
  for(const path of ['components/FileTree.tsx','panels/WorkspacePanel.tsx','panels/workspace/FolderPreview.tsx']){
    const source=readFileSync(resolve(root,'web/static/visual/frontend/src',path),'utf8');
    expect(source).toContain('utils/format"');expect(source).not.toContain('utils/formatBytes');
  }
  expect(existsSync(resolve(root,'web/static/visual/frontend/src/utils/formatBytes.ts'))).toBe(false);
});
