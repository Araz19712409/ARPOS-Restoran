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
        var node = Path.Combine(root, "runtime", "node.exe");
        if (!File.Exists(node))
        {
            node = "node";
        }
        var server = Path.Combine(root, "server.js");
        if (!File.Exists(server))
        {
            MessageBox.Show("server.js tapılmadı.", "Arpos Restoran", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        if (!PortOpen())
        {
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
        }
        Process.Start("http://127.0.0.1:" + Port + "/orders.html");
    }

    private static bool PortOpen()
    {
        try
        {
            using (var c = new TcpClient())
            {
                var ar = c.BeginConnect("127.0.0.1", Port, null, null);
                var ok = ar.AsyncWaitHandle.WaitOne(400);
                return ok && c.Connected;
            }
        }
        catch
        {
            return false;
        }
    }
}
