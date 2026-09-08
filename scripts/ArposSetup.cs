using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

internal static class ArposSetup
{
    private static int Main()
    {
        try
        {
            var dest = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ArposRestoran");
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
            var tmp = Path.Combine(Path.GetTempPath(), "arpos-extract");
            if (Directory.Exists(tmp))
            {
                Directory.Delete(tmp, true);
            }
            ZipFile.ExtractToDirectory(zip, tmp);
            CopyTree(tmp, dest);
            try { Directory.Delete(tmp, true); } catch { }
            try { File.Delete(zip); } catch { }
            var install = Path.Combine(dest, "scripts", "install.ps1");
            if (File.Exists(install))
            {
                var ps = new ProcessStartInfo
                {
                    FileName = "powershell",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + install + "\"",
                    UseShellExecute = false
                };
                var p = Process.Start(ps);
                if (p != null)
                {
                    p.WaitForExit();
                }
            }
            var bat = Path.Combine(dest, "scripts", "start-arpos.bat");
            if (File.Exists(bat))
            {
                Process.Start(new ProcessStartInfo { FileName = bat, UseShellExecute = true });
            }
            Console.WriteLine("Arpos Restoran quraşdırıldı. Lisenziya kodunu yazın.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static void CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.GetFiles(from))
        {
            File.Copy(file, Path.Combine(to, Path.GetFileName(file)), true);
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
}
