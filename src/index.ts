import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ValleySystem } from './valley-system.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(ValleySystem);
});
