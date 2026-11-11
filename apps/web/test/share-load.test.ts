import { describe, expect, it } from 'vitest';
import { SCHEMA } from '../src/scene/schema';
import { ShareError, loadPublishedScene, publishedPhotoUrls } from '../src/scene/share';

const PAGE = 'https://shop.example/bike-3d-brew/app/?view=present';
const published = {
  schema: SCHEMA,
  id: 'gravel-1',
  name: 'Gravel Bike X',
  model: { url: 'model.glb', format: 'glb' },
  background: 'studio',
  hotspots: [],
  annotations: [],
};

const respond = (body: unknown, status = 200) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('loadPublishedScene', () => {
  it('loads a scene and resolves it against the page', async () => {
    const { scene, href } = await loadPublishedScene('scenes/gravel-1/scene.json', PAGE, respond(published));
    expect(href).toBe('https://shop.example/bike-3d-brew/app/scenes/gravel-1/scene.json');
    expect(scene.name).toBe('Gravel Bike X');
  });

  it('turns a network failure into a readable ShareError', async () => {
    const fail = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(loadPublishedScene('s.json', PAGE, fail)).rejects.toThrow(/network request failed/);
  });

  it('reports HTTP errors with their status', async () => {
    await expect(loadPublishedScene('s.json', PAGE, respond('nope', 404))).rejects.toThrow(/\(404\)/);
  });

  it('reports invalid JSON and invalid scenes as ShareErrors', async () => {
    await expect(loadPublishedScene('s.json', PAGE, respond('{not json'))).rejects.toBeInstanceOf(ShareError);
    await expect(loadPublishedScene('s.json', PAGE, respond({ schema: 'other' }))).rejects.toThrow(/Could not load scene s\.json/);
    await expect(loadPublishedScene('s.json', PAGE, respond({ ...published, model: { url: 'blob:x', format: 'glb' } }))).rejects.toThrow(/without its 3D model/);
  });

  it('rejects scene addresses that are not on the site or https', async () => {
    await expect(loadPublishedScene('http://evil.example/s.json', PAGE, respond(published))).rejects.toBeInstanceOf(ShareError);
  });
});

describe('publishedPhotoUrls', () => {
  it('resolves relative photos and keeps only allowed URLs', () => {
    const base = 'https://shop.example/bike-3d-brew/app/scenes/gravel-1/scene.json';
    expect(publishedPhotoUrls(['photos/1.jpg', 'https://cdn.example/2.jpg', 'http://evil.example/3.jpg', 'https://u:p@cdn.example/4.jpg'], base, PAGE)).toEqual([
      'https://shop.example/bike-3d-brew/app/scenes/gravel-1/photos/1.jpg',
      'https://cdn.example/2.jpg',
    ]);
  });

  it('handles missing lists and unparseable entries', () => {
    expect(publishedPhotoUrls(undefined, PAGE, PAGE)).toEqual([]);
    expect(publishedPhotoUrls(['http://[bad'], PAGE, PAGE)).toEqual([]);
  });
});
