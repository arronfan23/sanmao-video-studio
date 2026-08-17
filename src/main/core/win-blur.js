// Win10 亚克力磨砂：通过 Win32 SetWindowCompositionAttribute（1803+）让透明窗口
// 背后的桌面内容被系统级模糊。koffi 纯 FFI 调用，任何失败都静默回退为普通半透明。
// koffi 的类型注册是全局的，重复 struct/func 会抛 Duplicate type name，做幂等缓存。
const cached = { setAttr: null, ACCENT_POLICY: null, WCA_DATA: null };

function applyAcrylicBlur(win) {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');

    if (!cached.setAttr) {
      cached.ACCENT_POLICY = koffi.struct('ACCENT_POLICY', {
        AccentState: 'int',
        AccentFlags: 'int',
        GradientColor: 'uint32',
        AnimationId: 'int',
      });
      cached.WCA_DATA = koffi.struct('WCA_DATA', {
        Attrib: 'int',
        pvData: koffi.pointer(cached.ACCENT_POLICY),
        cbData: 'size_t',
      });
      cached.setAttr = user32.func('bool SetWindowCompositionAttribute(void* hwnd, WCA_DATA* data)');
    }

    const accent = {
      AccentState: 4,            // ACCENT_ENABLE_ACRYLICBLURBEHIND
      AccentFlags: 0,
      GradientColor: 0xe614161a, // ABGR：约 90% 不透明的深色基底
      AnimationId: 0,
    };
    const data = { Attrib: 19, pvData: accent, cbData: 16 }; // WCA_ACCENT_POLICY = 19

    const hwnd = win.getNativeWindowHandle();
    return !!cached.setAttr(hwnd, data);
  } catch (err) {
    console.warn('[win-blur] 亚克力模糊不可用，回退普通半透明:', err.message);
    return false;
  }
}

module.exports = { applyAcrylicBlur };
