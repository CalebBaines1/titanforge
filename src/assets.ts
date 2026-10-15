import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'objective-panel': {
    url: publicAssetUrl('ui/objective.uikitml'),
    type: AssetType.UIKitML,
    name: 'Objective Panel',
  },
});
