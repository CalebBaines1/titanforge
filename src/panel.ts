import { createSystem, UIKitMLAsset, VisibilityState } from '@iwsdk/core';

/** Shows "Enter XR" in the browser and hides it inside the headset. */
export class PanelSystem extends createSystem({}) {
  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('objective-panel');
    const xrButton = panel?.getElementById('xr-button');
    if (xrButton == null) return;
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      return;
    }
    const launchXR = () => this.world.launchXR();
    xrButton.addEventListener('click', launchXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      this.world.visibilityState.subscribe((state) => {
        xrButton.setProperties({
          display: state === VisibilityState.NonImmersive ? 'flex' : 'none',
        });
      }),
    );
  }
}
