#!/usr/bin/env node
/**
 * 发布前微调脚本（构建 + 注入播放格式）——发布前最后一步
 *
 * 用法：
 *   node scripts/prepare.js webm     # 构建 + 注入 .webm（Chrome/Edge/Firefox 版）
 *   node scripts/prepare.js mov      # 构建 + 注入 .mov（Safari HEVC-alpha 版）
 *
 * 做什么：
 *   1. 构建（npm run bundle：tsdown 把 src/ → lib/）
 *   2. 注入：把 lib/client.js 中的占位符 __PET_EXT__ 替换为实际扩展名
 *      （src/client/pet.ts 里 THUMB_EXT 是占位符，不做运行时浏览器判断，
 *        格式由发布目标决定——本脚本在发布前把它定死）
 *   3. 改写 package.json：
 *      - files 收敛为单格式素材目录（mov → assets/mov；webm → assets/webm）
 *      - version 规范化（mov 加 -hevc 后缀；webm 去掉 -hevc 后缀）
 *      —— 幂等：跑一次即定格为当前格式状态，再跑同格式结果不变，无需备份/恢复
 *
 * 不做：
 *   - 不发布（npm publish 由你手动执行）
 *   - 不动素材目录
 *
 * 典型发布流程：
 *   node scripts/prepare.js mov
 *   npm publish --tag hevc            # 手动发布 mov 版（Safari）
 *   # 或 npm publish --tag latest     # webm 版（Chrome/Edge/Firefox）
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLIENT = join(ROOT, 'lib', 'client.js');
const PKG = join(ROOT, 'package.json');

const format = process.argv[2];
if (format !== 'webm' && format !== 'mov') {
  console.error('usage: node scripts/prepare.js <webm|mov>');
  process.exit(1);
}

// 1. 构建 src → lib
// Windows 下 npm 是 npm.cmd，spawnSync 无法直接执行 .cmd；用 cmd /c 跑整条命令
// （固定命令行，无用户输入，无注入风险）
console.log('[prepare] building (tsdown)...');
const npmRun = process.platform === 'win32' ? 'cmd /c npm run bundle' : 'npm run bundle';
const build = spawnSync(npmRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (build.status !== 0) {
  console.error(`[prepare] 构建失败 (exit ${build.status})`);
  process.exit(1);
}

// 2. 注入扩展名
const ext = format === 'mov' ? '.mov' : '.webm';
let src;
try {
  src = readFileSync(CLIENT, 'utf8');
} catch {
  console.error(`[prepare] 找不到 ${CLIENT} —— 构建失败?`);
  process.exit(1);
}
const marker = '__PET_EXT__';
if (!src.includes(marker)) {
  console.error(`[prepare] ${CLIENT} 中未找到占位符 ${marker} —— 产物已被注入或未重新构建，请先 npm run bundle`);
  process.exit(1);
}
writeFileSync(CLIENT, src.split(marker).join(ext), 'utf8');
console.log(`[prepare] ✓ lib/client.js THUMB_EXT → "${ext}"`);

// 3. 改写 package.json：files 收敛为单格式 + version 规范化（幂等，无备份）
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const assetDir = format === 'mov' ? 'assets/mov' : 'assets/webm';
const keep = ['lib', 'src', assetDir, 'assets/fonts', 'assets/pic', 'assets/config.jsonc', 'cordis.patch.yml'];
const baseVersion = String(pkg.version).replace(/-hevc$/, '');
const version = format === 'mov' ? `${baseVersion}-hevc` : baseVersion;
writeFileSync(PKG, JSON.stringify({ ...pkg, version, files: keep }, null, 2) + '\n', 'utf8');
console.log(`[prepare] ✓ package.json → version ${version}, files=[${keep.join(', ')}]`);
console.log(`[prepare] ready to publish: npm publish --tag ${format === 'mov' ? 'hevc' : 'latest'}`);
