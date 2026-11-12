using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SpineShelf;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        using var instance = new Mutex(true, @"Local\SpineShelf.Desktop", out bool first);
        if (!first)
        {
            IntPtr existing = FindWindow(null, "Spine Shelf");
            if (existing != IntPtr.Zero) { ShowWindow(existing, 9); SetForegroundWindow(existing); }
            return;
        }
        ApplicationConfiguration.Initialize();
        string appRoot = Path.Combine(AppContext.BaseDirectory, "app");
        int rootArg = Array.IndexOf(args, "--app-root");
        if (rootArg >= 0 && rootArg + 1 < args.Length) appRoot = Path.GetFullPath(args[rootArg + 1]);
        Application.Run(new ShelfWindow(appRoot));
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string? name, string title);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
}

internal sealed class ShelfWindow : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(37, 37, 37) };
    private readonly string root;
    private Process? server;
    private bool closing;
    private bool suspending;
    private const string Origin = "http://127.0.0.1:48731";

    public ShelfWindow(string appRoot)
    {
        root = appRoot;
        Text = "Spine Shelf";
        ClientSize = new Size(1200, 780);
        MinimumSize = new Size(640, 500);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(20, 20, 20);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Controls.Add(web);
        Shown += async (_, _) => await StartAsync();
        Resize += async (_, _) => await UpdateVisibilityAsync();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1;
        DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
        int rounded = 2;
        DwmSetWindowAttribute(Handle, 33, ref rounded, sizeof(int));
    }

    private async Task StartAsync()
    {
        try
        {
            if (!File.Exists(Path.Combine(root, "shelf.py"))) throw new FileNotFoundException("The app folder is missing. Extract the complete Spine Shelf ZIP before opening it.");
            if (!File.Exists(Path.Combine(root, "dist", "carousel.js"))) throw new FileNotFoundException("The interface is not built. Run npm ci and npm run build first.");
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
            bool running = false;
            try
            {
                string health = await client.GetStringAsync(Origin + "/health");
                if (!health.Contains("SpineShelf") || !health.Contains("0.2.1")) throw new InvalidOperationException("Port 48731 is occupied by another app version. Close that version first.");
                running = true;
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            if (!running)
            {
                string embedded = Path.Combine(AppContext.BaseDirectory, "python", "python.exe");
                var start = new ProcessStartInfo(File.Exists(embedded) ? embedded : "python")
                {
                    WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true
                };
                start.ArgumentList.Add("-u");
                start.ArgumentList.Add(Path.Combine(root, "shelf.py"));
                start.ArgumentList.Add("--server-only");
                server = Process.Start(start) ?? throw new InvalidOperationException("Could not start the local library service.");
                // Drain both pipes so a long-running app never blocks on log output.
                server.BeginOutputReadLine();
                server.BeginErrorReadLine();
                for (int i = 0; i < 60 && !closing; i++)
                {
                    if (server.HasExited) throw new InvalidOperationException("The library service exited. Check that port 48731 is free.");
                    try { if ((await client.GetStringAsync(Origin + "/health")).Contains("SpineShelf")) { running = true; break; } }
                    catch (HttpRequestException) { }
                    catch (TaskCanceledException) { }
                    await Task.Delay(100);
                }
                if (!running) throw new TimeoutException("The library service did not start in time.");
            }
            if (closing) return;
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SpineShelf", "Desktop Profile");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            if (closing) return;
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            web.CoreWebView2.Settings.IsWebMessageEnabled = false;
            web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
            web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
            web.CoreWebView2.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            web.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
            web.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!IsLocal(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); }
            };
            web.CoreWebView2.Navigate(Origin);
            await UpdateVisibilityAsync();
        }
        catch (Exception error)
        {
            if (!closing) { MessageBox.Show(this, error.Message + "\n\nSpine Shelf needs the Microsoft Edge WebView2 Runtime.", "Spine Shelf", MessageBoxButtons.OK, MessageBoxIcon.Information); Close(); }
        }
    }

    private static bool IsLocal(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 48731;

    private static void OpenExternal(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https") return;
        try { Process.Start(new ProcessStartInfo(value) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { }
    }

    private async Task UpdateVisibilityAsync()
    {
        if (closing || web.CoreWebView2 == null || suspending) return;
        if (WindowState == FormWindowState.Minimized)
        {
            suspending = true;
            web.Visible = false;
            try { await web.CoreWebView2.TrySuspendAsync(); }
            catch (InvalidOperationException) { }
            finally { suspending = false; }
            // A restore may arrive while TrySuspendAsync is pending.
            if (!closing && WindowState != FormWindowState.Minimized) { web.CoreWebView2.Resume(); web.Visible = true; }
        }
        else { web.CoreWebView2.Resume(); web.Visible = true; }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        closing = true;
        web.Dispose();
        if (server != null) { try { if (!server.HasExited) server.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } server.Dispose(); }
        base.OnFormClosed(e);
    }

    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
}
