/** electron-builder afterPack hook: flip Electron fuses (ARCHITECTURE.md §5.7).
 *  runAsNode off, Node CLI inspect args off, ASAR integrity on, only-load-from-ASAR on —
 *  the packaged binary cannot be repurposed as a generic Node runtime. */
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const path = require('node:path')

module.exports = async function afterPack(context) {
  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })
  console.log(`  • fuses flipped on ${exeName}`)
}
