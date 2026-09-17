using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class ArposLauncher
{
    private const int Port = 3004;

    [STAThread]
    private static void Main()
    {
        var root = Path.GetDirectoryName(Application.ExecutablePath);
        if (string.IsNullOrEmpty(root))
        {
            return;
        }
        Directory.SetCurrentDirectory(root);
        var node = FindNode(root);
        var server = Path.Combine(root, "server.js");
        if (!File.Exists(server))
        {
            MessageBox.Show("server.js tapılmadı.", "Arpos Restoran", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var alreadyOpen = PortOpen();
        if (alreadyOpen)
        {
            OpenOrdersExisting();
            return;
        }
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = node,
                Arguments = "\"server.js\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Server açılmadı. Node.js lazımdır.\n" + ex.Message, "Arpos Restoran",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        for (var i = 0; i < 40 && !PortOpen(); i++)
        {
            Thread.Sleep(250);
        }
        if (!PortOpen())
        {
            MessageBox.Show("Server 3004-də açılmadı. Node və ya portu yoxlayın.", "Arpos Restoran",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        OpenOrdersFullscreen();
    }

    private static string FindNode(string root)
    {
        var bundled = Path.Combine(root, "runtime", "node.exe");
        if (File.Exists(bundled))
        {
            return bundled;
        }
        var pf = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (File.Exists(pf))
        {
            return pf;
        }
        return "node.exe";
    }

    private static string FirstBrowser()
    {
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var paths = new[]
        {
            Path.Combine(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(pf, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(pf86, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(local, "Google", "Chrome", "Application", "chrome.exe")
        };
        for (var i = 0; i < paths.Length; i++)
        {
            if (File.Exists(paths[i]))
            {
                return paths[i];
            }
        }
        return "";
    }

    private static bool StartBrowser(string exe, string arguments)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = arguments,
                UseShellExecute = false
            });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool IsEdge(string exe)
    {
        return exe.IndexOf("msedge.exe", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static void OpenOrdersFullscreen()
    {
        var url = "http://127.0.0.1:" + Port + "/orders.html";
        var exe = FirstBrowser();
        if (exe.Length > 0)
        {
            if (StartBrowser(exe, "--new-window --start-fullscreen -- " + url))
            {
                return;
            }
            if (IsEdge(exe) && StartBrowser(exe, "--kiosk " + url + " --edge-kiosk-type=fullscreen"))
            {
                return;
            }
            if (StartBrowser(exe, "--new-window -- " + url))
            {
                return;
            }
        }
        try
        {
            Process.Start(url);
        }
        catch
        {
        }
    }

    private static void OpenOrdersExisting()
    {
        var url = "http://127.0.0.1:" + Port + "/orders.html";
        try
        {
            Process.Start(url);
        }
        catch
        {
        }
    }

    private static bool PortOpen()
    {
        try
        {
            using (var c = new TcpClient())
            {
                var ar = c.BeginConnect("127.0.0.1", Port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(800))
                {
                    return false;
                }
                c.EndConnect(ar);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }
}
