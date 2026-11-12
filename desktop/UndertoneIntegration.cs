using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Web.WebView2.Core;

namespace SpineShelf;

internal sealed partial class ShelfWindow
{
    private bool undertoneActionRunning;
    private static string LinkSettingsPath => Path.Combine(
        Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SpineShelf", "undertone-link.json");

    private sealed class UndertoneSettings
    {
        [JsonPropertyName("executable")] public string? Executable { get; set; }
        [JsonPropertyName("dataDirectory")] public string? DataDirectory { get; set; }
    }

    private static UndertoneSettings ReadUndertoneSettings()
    {
        try { return JsonSerializer.Deserialize<UndertoneSettings>(File.ReadAllText(LinkSettingsPath)) ?? new(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { return new(); }
    }

    private static void SaveUndertoneSettings(UndertoneSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(LinkSettingsPath)!);
        string temporary = LinkSettingsPath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(settings));
        File.Move(temporary, LinkSettingsPath, overwrite: true);
    }

    private static bool IsUndertoneExecutable(string? path) => !string.IsNullOrWhiteSpace(path)
        && Path.IsPathFullyQualified(path)
        && Path.GetFileName(path).Equals("Undertone.exe", StringComparison.OrdinalIgnoreCase)
        && File.Exists(path);

    private string? FindUndertoneExecutable(UndertoneSettings settings)
    {
        if (IsUndertoneExecutable(settings.Executable)) return settings.Executable;
        foreach (var process in Process.GetProcessesByName("Undertone"))
        {
            using (process)
            {
                try { if (IsUndertoneExecutable(process.MainModule?.FileName)) return process.MainModule!.FileName; }
                catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { }
            }
        }
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (string candidate in new[] {
            Path.Combine(local, "Programs", "Undertone", "Undertone.exe"),
            Path.Combine(local, "Undertone", "Undertone.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Undertone", "Undertone.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Undertone", "Undertone.exe") })
            if (IsUndertoneExecutable(candidate)) return candidate;
        return PickUndertoneExecutable();
    }

    private string? PickUndertoneExecutable()
    {
        using var picker = new OpenFileDialog {
            Title = "Locate Undertone.exe", Filter = "Undertone application (Undertone.exe)|Undertone.exe",
            CheckFileExists = true, Multiselect = false
        };
        if (picker.ShowDialog(this) != DialogResult.OK) return null;
        if (!IsUndertoneExecutable(picker.FileName)) throw new InvalidOperationException("Choose the Undertone.exe application.");
        return picker.FileName;
    }

    private void HandleUndertoneMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Only the app's top-level page can invoke these narrowly scoped native actions.
        if (!IsLocal(e.Source) || !Uri.TryCreate(e.Source, UriKind.Absolute, out var source)
            || source.AbsolutePath != "/" || undertoneActionRunning) return;
        string? action;
        try
        {
            using var json = JsonDocument.Parse(e.WebMessageAsJson);
            if (json.RootElement.ValueKind != JsonValueKind.Object || !json.RootElement.TryGetProperty("type", out var type)
                || type.ValueKind != JsonValueKind.String) return;
            action = type.GetString();
        }
        catch (JsonException) { return; }
        if (action is not ("undertone.open" or "undertone.locate" or "undertone.data-folder")) return;
        undertoneActionRunning = true;
        bool success = false;
        string message;
        try
        {
            var settings = ReadUndertoneSettings();
            if (action == "undertone.data-folder")
            {
                using var picker = new FolderBrowserDialog { Description = "Choose the Undertone data folder containing local-api.json", UseDescriptionForTitle = true };
                if (picker.ShowDialog(this) != DialogResult.OK) message = "Data folder selection canceled.";
                else if (!File.Exists(Path.Combine(picker.SelectedPath, "local-api.json")))
                    message = "That folder has no local-api.json. Enable Local API in Undertone first, then choose its data folder.";
                else
                {
                    settings.DataDirectory = picker.SelectedPath;
                    SaveUndertoneSettings(settings);
                    success = true;
                    message = "Undertone data folder linked. Connecting…";
                }
            }
            else
            {
                string? executable = action == "undertone.locate" ? PickUndertoneExecutable() : FindUndertoneExecutable(settings);
                if (executable == null) message = "App selection canceled. You can still connect if Undertone’s Local API is on.";
                else
                {
                    settings.Executable = executable;
                    SaveUndertoneSettings(settings);
                    if (action == "undertone.open")
                    {
                        using var process = Process.Start(new ProcessStartInfo(executable) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(executable)! });
                        message = "Undertone opened. Enable Local API in Settings → Integrations, then return here.";
                    }
                    else message = "Undertone app linked. Use Open Undertone to launch it.";
                    success = true;
                }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            message = "Could not link Undertone. Locate the application again and check that its folder is accessible.";
        }
        finally { undertoneActionRunning = false; }
        if (!closing && web.CoreWebView2 != null)
            web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "undertone-result", action, success, message }));
    }
}
