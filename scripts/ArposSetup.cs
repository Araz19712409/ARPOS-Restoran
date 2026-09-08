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
    private readonly bool silentUpdate;
    private readonly string silentDest;

    public ArposSetup() : this(null, false)
    {
    }

    public ArposSetup(string dest, bool silent)
    {
        silentUpdate = silent;
        silentDest = dest;
        Text = silent ? "Arpos Restoran — Yeniləmə" : "Arpos Restoran — Quraşdırma";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = silent ? new Size(420, 140) : new Size(460, 340);
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

        if (silent)
        {
            Controls.Add(MakeLabel("Arpos Restoran " + ArposVersion.Text + " yazılır…", 16, 16, 388, 22, true));
            bar = new ProgressBar { Left = 16, Top = 52, Width = 388, Height = 16, Style = ProgressBarStyle.Continuous };
            Controls.Add(bar);
            status = MakeLabel("Proqram bağlanır, fayllar yenilənir. data qalır.", 16, 80, 388, 36, false);
            Controls.Add(status);
            installBtn = null;
            pathBox = null;
            deskBox = null;
            startBox = null;
            runBox = null;
            autoBox = null;
            Shown += delegate { BeginSilent(); };
            return;
        }

        Controls.Add(MakeLabel("Arpos Restoran " + ArposVersion.Text, 16, 14, 420, 22, true));
        Controls.Add(MakeLabel("Restoran kassası. Bir server, port 3004.", 16, 38, 420, 18, false));
        Controls.Add(MakeLabel("Quraşdırma yeri", 16, 68, 420, 16, false));

        pathBox = new TextBox
        {
            Left = 16,
            Top = 88,
            Width = 330,
            Text = string.IsNullOrEmpty(dest)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Arpos Restoran")
                : dest
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

    private void BeginSilent()
    {
        try
        {
            Apply(silentDest, false, false, false, true);
            status.Text = "Yeniləndi. Proqram açılır.";
            bar.Value = 100;
            Application.DoEvents();
            Thread.Sleep(400);
            Close();
        }
        catch (Exception ex)
        {
            status.Text = "Xəta.";
            MessageBox.Show(ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
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
        try
        {
            Apply(dest, deskBox.Checked, startBox.Checked, autoBox.Checked, runBox.Checked);
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

    private void Apply(string dest, bool desk, bool startMenu, bool autoStart, bool runAfter)
    {
        dest = Path.GetFullPath(dest.Trim());
        SetStatus("Köhnə proses bağlanır...", 5);
        StopRunning(dest);
        Directory.CreateDirectory(dest);
        var zip = Path.Combine(Path.GetTempPath(), "arpos-payload-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".zip");
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
        SetStatus("Fayllar açılır...", 40);
        var tmp = Path.Combine(Path.GetTempPath(), "arpos-extract-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        if (Directory.Exists(tmp))
        {
            Directory.Delete(tmp, true);
        }
        ZipFile.ExtractToDirectory(zip, tmp);
        SetStatus("Fayllar yazılır...", 55);
        CopyTree(tmp, dest);
        try { Directory.Delete(tmp, true); } catch { }
        try { File.Delete(zip); } catch { }
        SetStatus("Qısayol...", 80);
        var exe = Path.Combine(dest, "ArposRestoran.exe");
        if (desk)
        {
            Shortcut(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), exe);
        }
        if (startMenu)
        {
            Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs"), exe);
        }
        if (autoStart)
        {
            var run = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
            if (run != null)
            {
                run.SetValue("ArposRestoran", "\"" + exe + "\"");
                run.Close();
            }
        }
        WriteUninstall(dest);
        SetStatus("Quraşdırıldı.", 100);
        if (runAfter && File.Exists(exe))
        {
            Process.Start(new ProcessStartInfo { FileName = exe, WorkingDirectory = dest, UseShellExecute = true });
        }
    }

    private void SetStatus(string text, int value)
    {
        if (status != null)
        {
            status.Text = text;
        }
        if (bar != null)
        {
            bar.Value = Math.Max(0, Math.Min(100, value));
        }
        Application.DoEvents();
    }

    private static void StopRunning(string dest)
    {
        var root = dest.TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
        KillByNames(root, new[] { "ArposRestoran", "node" });
        Thread.Sleep(1200);
        KillByNames(root, new[] { "ArposRestoran", "node" });
        Thread.Sleep(600);
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
                    var procName = "";
                    try { procName = p.ProcessName; } catch { }
                    if (procName.IndexOf("Setup", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        continue;
                    }
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
            if ((string.Equals(name, "data", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(name, "keys", StringComparison.OrdinalIgnoreCase)) &&
                Directory.Exists(Path.Combine(to, name)))
            {
                continue;
            }
            CopyTree(dir, Path.Combine(to, name));
        }
    }

    private static void CopyRetry(string from, string to)
    {
        Exception last = null;
        for (var i = 0; i < 16; i++)
        {
            try
            {
                File.Copy(from, to, true);
                return;
            }
            catch (Exception ex)
            {
                last = ex;
                Thread.Sleep(400);
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

    private static bool TryGithubDrop(out string dest)
    {
        dest = null;
        var exeDir = Path.GetDirectoryName(Application.ExecutablePath);
        if (string.IsNullOrEmpty(exeDir))
        {
            return false;
        }
        exeDir = Path.GetFullPath(exeDir);
        var hint = Path.Combine(exeDir, "install-dir.txt");
        if (File.Exists(hint))
        {
            var line = File.ReadAllText(hint).Trim();
            if (line.Length > 2 && (File.Exists(Path.Combine(line, "server.js")) ||
                File.Exists(Path.Combine(line, "ArposRestoran.exe"))))
            {
                dest = Path.GetFullPath(line);
                return true;
            }
        }
        var folder = Path.GetFileName(exeDir);
        var parent = Path.GetDirectoryName(exeDir);
        var parentName = string.IsNullOrEmpty(parent) ? "" : Path.GetFileName(parent);
        if (!string.Equals(folder, "updates", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(parentName, "data", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        dest = Path.GetFullPath(Path.Combine(parent, ".."));
        return File.Exists(Path.Combine(dest, "server.js")) ||
            File.Exists(Path.Combine(dest, "ArposRestoran.exe"));
    }

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        string dest = null;
        var silent = false;
        for (var i = 0; i < args.Length; i++)
        {
            if (string.Equals(args[i], "/update", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
            {
                dest = args[++i];
                silent = true;
            }
        }
        if (!silent && TryGithubDrop(out dest))
        {
            silent = true;
        }
        if (silent && !string.IsNullOrEmpty(dest))
        {
            Application.Run(new ArposSetup(dest, true));
            return;
        }
        Application.Run(new ArposSetup(dest, false));
    }
}
