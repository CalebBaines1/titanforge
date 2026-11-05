import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'hud-panel': {
    url: publicAssetUrl('ui/hud.uikitml'),
    type: AssetType.UIKitML,
    name: 'Valley HUD Panel',
  },
});
