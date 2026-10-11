# helmterm shell integration for PowerShell 7 and Windows PowerShell 5.1.
#
# helmterm runs this with -NoExit -Command after the user's profile has
# loaded. It marks the prompt (OSC 133 A and B), the command's start (C) and
# end with its exit code (D), reports the command line (OSC 633;E) and the
# directory (OSC 7). The user's prompt function and PSReadLine stay in
# charge; they are wrapped, not replaced. Nothing here is written to disk.

if ($Global:__HelmtermIntegration) { return }

$Global:__HelmtermIntegration = @{
    OriginalPrompt   = $function:prompt
    OriginalReadLine = $null
    LastHistoryId    = -1
    CommandRan       = $false
    Esc              = [string][char]27
    Bel              = [string][char]7
}

function Global:__Helmterm-Escape([string]$text) {
    # OSC 633's escaping: a backslash doubled, ';' and control characters as \xHH.
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $text.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq '\') { [void]$sb.Append('\\') }
        elseif ($ch -eq ';' -or $code -lt 32 -or $code -eq 127) { [void]$sb.Append(('\x{0:x2}' -f $code)) }
        else { [void]$sb.Append($ch) }
    }
    $sb.ToString()
}

function Global:__Helmterm-WrapReadLine {
    $st = $Global:__HelmtermIntegration
    if ($st.OriginalReadLine) { return }
    $existing = Get-Command -Name PSConsoleHostReadLine -CommandType Function -ErrorAction SilentlyContinue
    if (-not $existing) { return }
    $st.OriginalReadLine = $existing.ScriptBlock
    function Global:PSConsoleHostReadLine {
        $st = $Global:__HelmtermIntegration
        $line = & $st.OriginalReadLine
        if ("$line".Trim()) {
            $st.CommandRan = $true
            # The command line, then "output starts here", before it runs.
            [Console]::Write($st.Esc + ']633;E;' + (__Helmterm-Escape $line) + $st.Bel + $st.Esc + ']133;C' + $st.Bel)
        }
        $line
    }
}

function Global:prompt {
    # $? and $LASTEXITCODE first: anything below would change them.
    $ok = $global:?
    $native = $global:LASTEXITCODE
    $st = $Global:__HelmtermIntegration
    $out = ''
    $h = Get-History -Count 1
    $hid = if ($h) { $h.Id } else { -1 }
    if ($st.CommandRan -or ($st.LastHistoryId -ne -1 -and $hid -ne $st.LastHistoryId)) {
        $code = 0
        if (-not $ok) { if ($native -is [int] -and $native -ne 0) { $code = $native } else { $code = 1 } }
        $out += $st.Esc + ']133;D;' + $code + $st.Bel
    }
    $st.CommandRan = $false
    $st.LastHistoryId = $hid
    __Helmterm-WrapReadLine
    $loc = $executionContext.SessionState.Path.CurrentLocation
    if ($loc.Provider.Name -eq 'FileSystem') {
        $path = $loc.ProviderPath -replace '\\', '/' -replace '%', '%25'
        if ($path -notmatch '^/') { $path = '/' + $path }
        $out += $st.Esc + ']7;file://' + [System.Net.Dns]::GetHostName() + $path + $st.Esc + '\'
    }
    $out += $st.Esc + ']133;A' + $st.Bel
    $inner = if ($st.OriginalPrompt) { & $st.OriginalPrompt } else { 'PS ' + $loc.Path + '> ' }
    # The user's prompt may itself depend on $LASTEXITCODE: give it back.
    $global:LASTEXITCODE = $native
    $out + (-join $inner) + $st.Esc + ']133;B' + $st.Bel
}

__Helmterm-WrapReadLine
