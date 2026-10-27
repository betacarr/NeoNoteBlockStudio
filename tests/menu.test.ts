import { describe, expect, it } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { applicationMenu } from '../electron/menu';
import { inspectShortcuts } from '../src/core/shortcuts';

const children = (item: MenuItemConstructorOptions | undefined) => item?.submenu as MenuItemConstructorOptions[];
describe('platform application menu', () => {
  it('gives macOS its application, close-window, services and window menus', () => {
    const menu = applicationMenu('darwin', () => () => {});
    expect(menu[0].label).toBe('NeoNBS');
    expect(children(menu[0]).filter(item => item.role).map(item => item.role)).toEqual(['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']);
    expect(children(menu.find(item => item.label === '文件')).some(item => item.role === 'close')).toBe(true);
    expect(children(menu.find(item => item.label === '文件')).some(item => item.role === 'quit')).toBe(false);
    expect(menu.some(item => item.role === 'windowMenu')).toBe(true);
  });
  it('dispatches Preferences through the editor command without stealing native keys', () => {
    const commands: string[] = [];
    const menu = applicationMenu('darwin', command => () => { commands.push(command); });
    const settings = children(menu[0]).find(item => item.label === '设置…')!;
    expect(settings.accelerator).toBe('Command+,');
    settings.click!({} as never, {} as never, {} as never);
    expect(commands).toEqual(['settings']);
    for (const binding of ['Cmd+W', 'Cmd+,', 'Cmd+H', 'Cmd+Alt+H', 'Cmd+M']) {
      expect(inspectShortcuts('fl', { mixer: binding }, 'darwin').valid).toBe(false);
    }
  });
  it('keeps Windows quit in File and leaves editor shortcuts with the renderer', () => {
    const menu = applicationMenu('win32', () => () => {});
    expect(menu[0].label).toBe('文件');
    expect(children(menu[0]).some(item => item.role === 'quit')).toBe(true);
    expect(menu.some(item => item.role === 'windowMenu')).toBe(false);
    expect(children(menu.find(item => item.label === '编辑')).every(item => !item.accelerator)).toBe(true);
    expect(inspectShortcuts('fl', { mixer: 'Ctrl+W' }, 'win32').valid).toBe(true);
  });
});
