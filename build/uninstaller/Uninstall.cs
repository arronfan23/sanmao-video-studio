using System;
using System.Diagnostics;
using Microsoft.Win32;

// 安装目录内的卸载助手：从注册表找到本产品的 UninstallString 并调起 MSI 卸载流程。
// 用系统自带 csc.exe 编译，无第三方依赖。
class Uninstaller
{
    const string AppName = "Sanmao Video Studio";
    static readonly string[] Hives =
    {
        @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    };

    static int Main()
    {
        foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            foreach (var hive in Hives)
            {
                using (var key = root.OpenSubKey(hive))
                {
                    if (key == null) continue;
                    foreach (var sub in key.GetSubKeyNames())
                    {
                        using (var sk = key.OpenSubKey(sub))
                        {
                            if (sk == null) continue;
                            var name = sk.GetValue("DisplayName") as string;
                            if (name != AppName) continue;
                            var uninstall = sk.GetValue("UninstallString") as string;
                            if (string.IsNullOrEmpty(uninstall)) continue;
                            Process.Start(new ProcessStartInfo("cmd.exe", "/c " + uninstall)
                            {
                                UseShellExecute = true,
                            });
                            return 0;
                        }
                    }
                }
            }
        }
        return 1;
    }
}
