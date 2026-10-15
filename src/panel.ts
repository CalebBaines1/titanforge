import { createSystem, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { music } from './music.js';

/** Shows "Enter XR" in the browser and hides it inside the headset. */
export class PanelSystem extends createSystem({}) {
  init(): void {
    // Browsers only allow audio after a user gesture: start on the first tap
    // or click, and follow the XR session in and out.
    const onFirstGesture = () => music.start();
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', onFirstGesture),
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible) music.start();
        else if (state === VisibilityState.VisibleBlurred) music.stop();
      }),
    );
    const panel = this.world.getSceneObject<UIKitMLAsset>('objective-panel');
    const xrButton = panel?.getElementById('xr-button');
    if (xrButton == null) return;
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      return;
    }
    const launchXR = () => {
      music.start();
      this.world.launchXR();
    };
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
