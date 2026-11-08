import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const base = path.resolve('.local/native-glass-qa');
await mkdir(base, { recursive: true });
const profile = await mkdtemp(path.join(base, 'profile-'));
const packagedFlag = process.argv.indexOf('--packaged');
if (packagedFlag >= 0 && !process.argv[packagedFlag + 1]) throw new Error('--packaged requires the app executable.');
const executablePath = packagedFlag >= 0 ? path.resolve(process.argv[packagedFlag + 1]) : undefined;
const env = { ...process.env, NBSX_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NBSX_DEV_URL;
const desktop = await electron.launch({ executablePath, args: [...(executablePath ? [] : ['.']), '--mute-audio', `--user-data-dir=${profile}`], env, timeout: 120000 });
try {
  const page = await desktop.firstWindow(), studio = page.locator('.studio');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const openAppearance = async () => {
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
  };
  const native = page.getByRole('radio', { name: 'Liquid Glass · macOS 原生' });
  const web = page.getByRole('radio', { name: 'Liquid Glass · 跨平台' });
  const close = () => page.getByRole('button', { name: '关闭', exact: true }).click();
  const version = await desktop.evaluate(() => process.platform === 'darwin' ? Number(process.getSystemVersion().split('.')[0]) : 0);
  await openAppearance();
  if (version < 26) {
    await native.waitFor();
    assert.equal(await native.isEnabled(), false);
    assert.equal(await page.evaluate(() => window.desktop.nativeGlassSupported()), false);
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem('nbsx-preferences'));
      localStorage.setItem('nbsx-preferences', JSON.stringify({ ...prefs, appearance: 'native-glass' }));
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.studio')?.dataset.appearance === 'liquid-glass');
    console.log('Native choice unavailable; saved native preference falls back to Web.');
  } else {
    const nativeViewCount = () => desktop.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const koffi = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')('koffi');
      const objc = koffi.load('/usr/lib/libobjc.A.dylib');
      const cls = objc.func('void *objc_getClass(const char *)')('NSGlassEffectView');
      const sel = objc.func('void *sel_registerName(const char *)');
      const call = (returns, args = []) => objc.func('objc_msgSend', returns, ['void *', 'void *', ...args]);
      const get = call('void *'), at = call('void *', ['size_t']), isKind = call('bool', ['void *']);
      const host = get(get(window.getNativeWindowHandle().readBigUInt64LE(), sel('window')), sel('contentView'));
      const subviews = get(host, sel('subviews'));
      const count = call('size_t')(subviews, sel('count'));
      return Array.from({ length: count }, (_, i) => at(subviews, sel('objectAtIndex:'), i))
        .filter(view => isKind(view, sel('isKindOfClass:'), cls)).length;
    });
    const waitForNative = () => page.waitForFunction(() => document.querySelector('.studio')?.dataset.nativeGlass === 'active');
    assert.equal(await nativeViewCount(), 0);
    assert.equal(await page.evaluate(() => window.desktop.setNativeGlass({ x: 0, y: 500, width: 100, height: 20 })), false);
    await native.check(); await waitForNative(); await close();
    assert.equal(await nativeViewCount(), 1);
    assert.equal(await page.locator('.liquid-glass-backdrop').count(), 0);
    assert.equal(await page.locator('.control-bar').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    const mixer = page.locator('.control-bar').getByRole('button', { name: '混音器', exact: true });
    await mixer.click();
    await page.locator('.mixer-console').waitFor();
    await mixer.click();
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1050, 720);
      window.webContents.setZoomFactor(1.25);
    });
    await page.waitForFunction(() => innerWidth <= 850);
    assert.equal(await nativeViewCount(), 1);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.reload(); await waitForNative();
    assert.equal(await nativeViewCount(), 1);
    await openAppearance(); await web.check();
    await page.waitForFunction(() => document.querySelector('.studio')?.dataset.appearance === 'liquid-glass' && !document.querySelector('.studio')?.dataset.nativeGlass);
    // IPC ordering: the clearing operation must finish before inspecting AppKit.
    await page.evaluate(() => window.desktop.nativeGlassSupported());
    assert.equal(await nativeViewCount(), 0);
    await page.getByRole('radio', { name: '经典', exact: true }).check(); await close();
    assert.equal(await studio.getAttribute('data-appearance'), 'classic');
    await openAppearance(); await native.check(); await waitForNative(); await close();
    assert.equal(await nativeViewCount(), 1);
    console.log('Verified actual NSGlassEffectView, input routing, resize and zoom, reload, and cleanup.');
  }
  assert.deepEqual(errors, []);
} finally {
  await desktop.close();
}
