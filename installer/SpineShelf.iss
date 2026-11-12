#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef PackageDir
  #error PackageDir is required
#endif
#ifndef DepsFile
  #error DepsFile is required
#endif
#include DepsFile

[Setup]
AppId={{639537B8-92F6-4F5D-8540-96082F297752}
AppName=Spine Shelf
AppVersion={#AppVersion}
AppPublisher=Mayank Praveen Kumar
AppPublisherURL=https://github.com/Mayank-Praveen-Kumar/spine-shelf
AppSupportURL=https://github.com/Mayank-Praveen-Kumar/spine-shelf/issues
AppUpdatesURL=https://github.com/Mayank-Praveen-Kumar/spine-shelf/releases
DefaultDirName={localappdata}\Programs\Spine Shelf
DefaultGroupName=Spine Shelf
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\release
OutputBaseFilename=SpineShelf-{#AppVersion}-Setup-x64
SetupIconFile=..\assets\spine-shelf.ico
UninstallDisplayIcon={app}\SpineShelf.exe
LicenseFile=..\LICENSE
WizardStyle=modern
Compression=lzma2/fast
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
AppMutex=Local\SpineShelf.Desktop
VersionInfoVersion={#AppVersion}.0
VersionInfoProductName=Spine Shelf
UninstallDisplayName=Spine Shelf

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.pdb,*.xml"
Source: "{#WebViewInstaller}"; Flags: dontcopy

[Icons]
Name: "{group}\Spine Shelf"; Filename: "{app}\SpineShelf.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Spine Shelf"; Filename: "{app}\SpineShelf.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\SpineShelf.exe"; Description: "Open Spine Shelf"; Flags: nowait postinstall skipifsilent

[Code]
var
  DownloadPage: TDownloadWizardPage;

function DesktopRuntimeInRoot(Root: Integer): Boolean;
var
  Versions: TArrayOfString;
  I: Integer;
begin
  Result := False;
  if RegGetValueNames(Root, 'SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.WindowsDesktop.App', Versions) then
    for I := 0 to GetArrayLength(Versions) - 1 do
      if Pos('10.0.', Versions[I]) = 1 then begin Result := True; Exit; end;
end;

function HasDesktopRuntime: Boolean;
var
  Root, Shared: String;
  Found: TFindRec;
begin
  Result := DesktopRuntimeInRoot(HKLM64) or DesktopRuntimeInRoot(HKCU64);
  if Result then Exit;
  { Some runtime installations have no sharedfx registry values. }
  if not RegQueryStringValue(HKLM64, 'SOFTWARE\dotnet\Setup\InstalledVersions\x64', 'InstallLocation', Root) then
    Root := ExpandConstant('{commonpf64}\dotnet');
  Shared := AddBackslash(Root) + 'shared\Microsoft.WindowsDesktop.App\';
  if FileExists(AddBackslash(Root) + 'dotnet.exe') and FindFirst(Shared + '10.0.*', Found) then begin
    try
      repeat
        if FileExists(Shared + Found.Name + '\System.Windows.Forms.dll') then begin Result := True; Exit; end;
      until not FindNext(Found);
    finally FindClose(Found); end;
  end;
end;

function HasWebView: Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  if Result then Result := (Version <> '') and (Version <> '0.0.0.0');
  if not Result then begin
    Result := RegQueryStringValue(HKCU32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
    if Result then Result := (Version <> '') and (Version <> '0.0.0.0');
  end;
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage('Windows components', 'Downloading the Microsoft .NET Desktop Runtime needed by Spine Shelf.', nil);
  DownloadPage.ShowBaseNameInsteadOfUrl := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  Log('Checking shared Windows runtimes.');
  if not HasDesktopRuntime then begin
    DownloadPage.Clear;
    DownloadPage.Add('{#DotNetUrl}', 'windowsdesktop-runtime-x64.exe', '{#DotNetSHA256}');
    DownloadPage.Show;
    try
      try DownloadPage.Download;
      except Result := 'Could not download the Microsoft .NET Desktop Runtime. Check your internet connection and try again. ' + GetExceptionMessage; end;
    finally DownloadPage.Hide; end;
    if Result <> '' then Exit;
    if not ShellExec('runas', ExpandConstant('{tmp}\windowsdesktop-runtime-x64.exe'), '/install /passive /norestart', '', SW_SHOWNORMAL, ewWaitUntilTerminated, ExitCode) then begin
      Result := 'The Microsoft .NET Desktop Runtime could not be installed. Approve its Windows administrator prompt, then retry.'; Exit;
    end;
    if (ExitCode <> 0) and (ExitCode <> 3010) then begin Result := 'Microsoft .NET setup returned code ' + IntToStr(ExitCode) + '.'; Exit; end;
    if ExitCode = 3010 then NeedsRestart := True;
    if not HasDesktopRuntime then begin Result := 'The .NET 10 Desktop Runtime is still unavailable. Install it from dotnet.microsoft.com, then retry.'; Exit; end;
  end else Log('.NET 10 Desktop Runtime already present.');
  if not HasWebView then begin
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin Result := 'Could not start the Microsoft WebView2 installer.'; Exit; end;
    if not HasWebView then begin Result := 'Microsoft WebView2 could not be installed. Install it from microsoft.com/edge/webview2, then retry.'; Exit; end;
  end else Log('Microsoft WebView2 Runtime already present.');
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo + NewLine + NewLine + MemoTasksInfo;
  if not HasDesktopRuntime then Result := Result + NewLine + 'Downloads Microsoft .NET 10 Desktop Runtime (requires an administrator prompt).';
  if not HasWebView then Result := Result + NewLine + 'Installs Microsoft Edge WebView2 Runtime.';
  Result := Result + NewLine + NewLine + 'Your existing books and reading preferences are kept. Uninstall removes the app, not your library.';
end;
