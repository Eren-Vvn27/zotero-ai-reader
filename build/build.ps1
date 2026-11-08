# Build the installable .xpi for AI 论文助手.
# Usage: pwsh -File build/build.ps1 [-Version 0.1.0]
param(
	[string]$Version = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"

# Zotero parses manifest.json as strict JSON, which rejects a UTF-8 BOM.
# PowerShell's `Set-Content -Encoding UTF8` adds one, so fail fast here.
$manifestBytes = [System.IO.File]::ReadAllBytes($manifestPath)
if ($manifestBytes.Length -ge 3 -and $manifestBytes[0] -eq 0xEF -and $manifestBytes[1] -eq 0xBB -and $manifestBytes[2] -eq 0xBF) {
	throw "manifest.json starts with a UTF-8 BOM - save it as UTF-8 without BOM, otherwise Zotero cannot parse it"
}

$manifestText = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8)
$manifest = $manifestText | ConvertFrom-Json
if (-not $Version) { $Version = $manifest.version }

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$target = Join-Path $dist "zotero-ai-reader-$Version.xpi"
if (Test-Path $target) { Remove-Item $target -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($target, [System.IO.Compression.ZipArchiveMode]::Create)
try {
	$files = @("manifest.json", "bootstrap.js", "prefs.js")
	foreach ($name in $files) {
		$path = Join-Path $root $name
		if (-not (Test-Path $path)) { throw "missing $name" }
		[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
			$zip, $path, $name, [System.IO.Compression.CompressionLevel]::Optimal
		) | Out-Null
	}

	foreach ($dir in @("chrome", "locale")) {
		$base = Join-Path $root $dir
		if (-not (Test-Path $base)) { continue }
		Get-ChildItem $base -Recurse -File | ForEach-Object {
			$relative = $_.FullName.Substring($root.Length + 1).Replace("\", "/")
			[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
				$zip, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal
			) | Out-Null
		}
	}
}
finally {
	$zip.Dispose()
}

Write-Output "Built: $target"
Write-Output ("Size : {0:N0} KB" -f ((Get-Item $target).Length / 1KB))
