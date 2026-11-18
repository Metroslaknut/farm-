import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import '../src/models';
import { ALL_MODELS } from '../src/db/registry';

describe('model registry', () => {
  it('lists every model, so index management and backups can never silently skip a collection', () => {
    const registered = ALL_MODELS.map((m) => m.modelName).sort();
    expect(registered).toEqual([...mongoose.modelNames()].sort());
    expect(new Set(registered).size).toBe(registered.length);
  });
});
