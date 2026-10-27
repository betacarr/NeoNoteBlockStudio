import type { MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from '../src/core/app-identity';

export function applicationMenu(platform: string, send: (command: string) => () => void): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  return [
    ...(mac ? [{ label: APP_NAME, submenu: [
      { role: 'about', label: `关于 ${APP_NAME}` },
      { type: 'separator' }, { label: '设置…', accelerator: 'Command+,', click: send('settings') },
      { type: 'separator' }, { role: 'services', label: '服务' },
      { type: 'separator' }, { role: 'hide', label: `隐藏 ${APP_NAME}` }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '显示全部' },
      { type: 'separator' }, { role: 'quit', label: `退出 ${APP_NAME}` },
    ] } satisfies MenuItemConstructorOptions] : []),
    { label: '文件', submenu: [
      { label: '新建工程', accelerator: 'CmdOrCtrl+N', click: send('new') }, { label: '打开 / 导入…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: '保存工程', accelerator: 'CmdOrCtrl+S', click: send('save') }, { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
      { type: 'separator' }, { label: '导出…', click: send('export') },
      mac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
    ] },
    // Editor accelerators are handled in the renderer so custom mappings and
    // text fields share one dispatch path. Native menu clicks use the same IPC.
    { label: '编辑', submenu: [{ label: '撤销', click: send('undo') }, { label: '重做', click: send('redo') }, { type: 'separator' }, { label: '复制', click: send('copy') }, { label: '剪切', click: send('cut') }, { label: '粘贴', click: send('paste') }, { label: '独立复制', click: send('duplicate') }, { label: '在播放头拆分片段', click: send('split-region') }, { label: '全选', click: send('select-all') }] },
    { label: '轨道', submenu: [{ label: '添加轨道', click: send('add-track') }, { label: '上移当前轨道', click: send('track-up') }, { label: '下移当前轨道', click: send('track-down') }, { type: 'separator' }, { label: '删除当前轨道', click: send('delete-track') }] },
    { label: '视图', submenu: [{ label: '混音器', click: send('mixer') }, { label: '设置', click: send('settings') }, { role: 'togglefullscreen', label: '全屏' }, { role: 'toggleDevTools', label: '开发工具' }] },
    { label: '播放', submenu: [{ label: '播放 / 暂停', click: send('play') }, { label: '停止并回到起点', click: send('stop') }, { label: '循环播放工程', click: send('loop') }, { type: 'separator' }, { label: '上一小节', click: send('previous-bar') }, { label: '下一小节', click: send('next-bar') }] },
    ...(mac ? [{ role: 'windowMenu', label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { type: 'separator' }, { role: 'front', label: '前置全部窗口' }] } satisfies MenuItemConstructorOptions] : []),
  ];
}
