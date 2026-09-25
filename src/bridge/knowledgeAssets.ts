import { writePlatformFileBinary } from '@purescience/platform-ui/bridge/fs'
import { updateCollectionAsset } from '@purescience/platform-ui/bridge/assets'
import { uint8ArrayToBase64 } from '@purescience/platform-editor/insertCollectionImage.ts'
import { buildPastedFigureRelativePath } from '@purescience/platform-ui/bridge/collectionImagePaste'
import type { readAssetTransfer } from '@purescience/platform-editor/assetTransfer.ts'
export async function saveKnowledgeImage(packagePath: string, image: ReturnType<typeof readAssetTransfer>) {
  if (!packagePath.endsWith('.knowledge')) throw new Error('Open a knowledge package before dropping images.')
  const relativePath = buildPastedFigureRelativePath('assets', `${crypto.randomUUID()}-${image.name}`, image.mimeType)
  const absolutePath = `${packagePath}/${relativePath}`
  const base64 = uint8ArrayToBase64(image.bytes)
  await writePlatformFileBinary(absolutePath,base64)
  await updateCollectionAsset({collectionPath:packagePath,relativePath,label:image.alt || image.name,caption:image.caption ?? ''})
  return {relativePath,absolutePath,dataUrl:`data:${image.mimeType};base64,${base64}`}
}
