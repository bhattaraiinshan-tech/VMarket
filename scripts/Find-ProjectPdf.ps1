[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

$paths = & git -C $repositoryRoot -c core.quotepath=false ls-files --cached --others --exclude-standard -- '*.pdf'
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to list project PDFs using Git.'
}

$paths |
    Sort-Object -Unique |
    ForEach-Object {
        $relativePath = $_ -replace '/', '\'
        Get-Item -LiteralPath (Join-Path $repositoryRoot $relativePath)
    } |
    Select-Object FullName, Length
