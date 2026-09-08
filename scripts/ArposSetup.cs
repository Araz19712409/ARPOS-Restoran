using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal sealed class ArposSetup : Form
{
    private readonly TextBox pathBox;
    private readonly CheckBox deskBox;
    private readonly CheckBox startBox;
    private readonly CheckBox runBox;
    private readonly CheckBox autoBox;
    private readonly Button installBtn;
    private readonly ProgressBar bar;
    private readonly Label status;

    public ArposSetup()
    {
        Text = "Arpos Restoran — Quraşdırma";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 340);
        BackColor = Color.FromArgb(36, 30, 24);
        ForeColor = Color.FromArgb(246, 239, 228);
        Font = new Font("Segoe UI", 9F);
        try
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }
        catch
        {
        }

        Controls.Add(MakeLabel("Arpos Restoran " + ArposVersion.Text, 16, 14, 420, 22, true));
        Controls.Add(MakeLabel("Restoran kassası. Bir server, port 3004.", 16, 38, 420, 18, false));
        Controls.Add(MakeLabel("Quraşdırma yeri", 16, 68, 420, 16, false));

        pathBox = new TextBox
        {
            Left = 16,
            Top = 88,
            Width = 330,
            Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Arpos Restoran")
        };
        Controls.Add(pathBox);

        var browse = new Button { Left = 354, Top = 86, Width = 90, Height = 26, Text = "Seç", FlatStyle = FlatStyle.Flat };
        browse.Click += delegate { Browse(); };
        Controls.Add(browse);

        deskBox = MakeCheck("İş masasında qısayol", 16, 128, true);
        startBox = MakeCheck("Başlat menyusu", 16, 154, true);
        autoBox = MakeCheck("Windows açılanda başlasın", 16, 180, false);
        runBox = MakeCheck("Quraşdırandan sonra aç", 16, 206, true);
        Controls.Add(deskBox);
        Controls.Add(startBox);
        Controls.Add(autoBox);
        Controls.Add(runBox);

        bar = new ProgressBar { Left = 16, Top = 242, Width = 428, Height = 16, Style = ProgressBarStyle.Continuous };
        Controls.Add(bar);

        status = MakeLabel("Node daxildir. Lisenziya ilk açılışda soruşulur.", 16, 264, 428, 18, false);
        Controls.Add(status);

        installBtn = new Button
        {
            Left = 250,
            Top = 294,
            Width = 194,
            Height = 34,
            Text = "Quraşdır",
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(201, 132, 42),
            ForeColor = Color.White
        };
        installBtn.Click += delegate { Install(); };
        Controls.Add(installBtn);

        var cancel = new Button { Left = 16, Top = 294, Width = 90, Height = 34, Text = "Bağla", FlatStyle = FlatStyle.Flat };
        cancel.Click += delegate { Close(); };
        Controls.Add(cancel);
    }

    private static Label MakeLabel(string text, int x, int y, int w, int h, bool title)
    {
        return new Label
        {
            Text = text,
            Left = x,
            Top = y,
            Width = w,
            Height = h,
            Font = new Font("Segoe UI", title ? 12F : 9F, title ? FontStyle.Bold : FontStyle.Regular)
        };
    }

    private CheckBox MakeCheck(string text, int x, int y, bool on)
    {
        return new CheckBox
        {
            Text = text,
            Left = x,
            Top = y,
            Width = 420,
            Height = 22,
            Checked = on,
            ForeColor = Color.FromArgb(246, 239, 228)
        };
    }

    private void Browse()
    {
        using (var d = new FolderBrowserDialog())
        {
            d.SelectedPath = pathBox.Text;
            if (d.ShowDialog(this) == DialogResult.OK)
            {
                pathBox.Text = d.SelectedPath;
            }
        }
    }

    private void Install()
    {
        var dest = pathBox.Text.Trim();
        if (dest.Length < 3)
        {
            MessageBox.Show("Qovluq seçin.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        installBtn.Enabled = false;
        bar.Value = 5;
        status.Text = "Köhnə proses bağlanır...";
        Application.DoEvents();
        try
        {
            StopRunning(dest);
            Directory.CreateDirectory(dest);
            var zip = Path.Combine(Path.GetTempPath(), "arpos-payload.zip");
            using (var src = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            {
                if (src == null)
                {
                    throw new Exception("Quraşdırma paketi tapılmadı.");
                }
                using (var fs = File.Create(zip))
                {
                    src.CopyTo(fs);
                }
            }
            bar.Value = 40;
            Application.DoEvents();
            var tmp = Path.Combine(Path.GetTempPath(), "arpos-extract");
            if (Directory.Exists(tmp))
            {
                Directory.Delete(tmp, true);
            }
            ZipFile.ExtractToDirectory(zip, tmp);
            status.Text = "Fayllar yazılır...";
            Application.DoEvents();
            CopyTree(tmp, dest);
            try { Directory.Delete(tmp, true); } catch { }
            try { File.Delete(zip); } catch { }
            bar.Value = 80;
            var exe = Path.Combine(dest, "ArposRestoran.exe");
            if (deskBox.Checked)
            {
                Shortcut(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), exe);
            }
            if (startBox.Checked)
            {
                Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs"), exe);
            }
            if (autoBox.Checked)
            {
                var run = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
                if (run != null)
                {
                    run.SetValue("ArposRestoran", "\"" + exe + "\"");
                    run.Close();
                }
            }
            WriteUninstall(dest);
            bar.Value = 100;
            status.Text = "Quraşdırıldı.";
            if (runBox.Checked && File.Exists(exe))
            {
                Process.Start(new ProcessStartInfo { FileName = exe, WorkingDirectory = dest, UseShellExecute = true });
            }
            MessageBox.Show("Arpos Restoran quraşdırıldı.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch (Exception ex)
        {
            installBtn.Enabled = true;
            status.Text = "Xəta.";
            MessageBox.Show(ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void StopRunning(string dest)
    {
        var root = dest.TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
        KillByNames(root, new[] { "ArposRestoran", "node" });
        Thread.Sleep(800);
        KillByNames(root, new[] { "ArposRestoran", "node" });
        Thread.Sleep(400);
    }

    private static void KillByNames(string root, string[] names)
    {
        foreach (var name in names)
        {
            Process[] list;
            try
            {
                list = Process.GetProcessesByName(name);
            }
            catch
            {
                continue;
            }
            foreach (var p in list)
            {
                try
                {
                    string path = null;
                    try { path = p.MainModule != null ? p.MainModule.FileName : null; } catch { }
                    if (string.IsNullOrEmpty(path))
                    {
                        continue;
                    }
                    var full = Path.GetFullPath(path);
                    if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(full, Path.Combine(root.TrimEnd('\\'), "runtime", "node.exe"), StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(4000);
                    }
                }
                catch
                {
                }
                finally
                {
                    try { p.Dispose(); } catch { }
                }
            }
        }
    }

    private static void CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.GetFiles(from))
        {
            CopyRetry(file, Path.Combine(to, Path.GetFileName(file)));
        }
        foreach (var dir in Directory.GetDirectories(from))
        {
            var name = Path.GetFileName(dir);
            if (string.Equals(name, "data", StringComparison.OrdinalIgnoreCase) &&
                Directory.Exists(Path.Combine(to, "data")))
            {
                continue;
            }
            CopyTree(dir, Path.Combine(to, name));
        }
    }

    private static void CopyRetry(string from, string to)
    {
        Exception last = null;
        for (var i = 0; i < 10; i++)
        {
            try
            {
                File.Copy(from, to, true);
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                Thread.Sleep(300);
            }
        }
        throw last ?? new IOException(to);
    }

    private static void Shortcut(string folder, string exe)
    {
        Directory.CreateDirectory(folder);
        var link = Path.Combine(folder, "Arpos Restoran.lnk");
        try
        {
            var t = Type.GetTypeFromProgID("WScript.Shell");
            var shell = Activator.CreateInstance(t);
            var lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
            var lt = lnk.GetType();
            lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { exe });
            lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { Path.GetDirectoryName(exe) });
            lt.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { "Arpos Restoran" });
            lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { exe + ",0" });
            lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            Marshal.FinalReleaseComObject(lnk);
            Marshal.FinalReleaseComObject(shell);
        }
        catch
        {
            File.Copy(exe, Path.Combine(folder, "ArposRestoran.exe"), true);
        }
    }

    private static void WriteUninstall(string dest)
    {
        var bat = Path.Combine(dest, "Uninstall.bat");
        File.WriteAllText(bat,
            "@echo off\r\n" +
            "reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v ArposRestoran /f >nul 2>&1\r\n" +
            "del /q \"%USERPROFILE%\\Desktop\\Arpos Restoran.lnk\" >nul 2>&1\r\n" +
            "del /q \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Arpos Restoran.lnk\" >nul 2>&1\r\n" +
            "echo Data qalir. Program silinir.\r\n" +
            "cd /d \"%TEMP%\"\r\n" +
            "rmdir /s /q \"" + dest + "\"\r\n");
    }

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.Run(new ArposSetup());
    }
}
