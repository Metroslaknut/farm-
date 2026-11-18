import type { RequestHandler } from 'express';
import { updateSettingsSchema } from '@farmplus/validation';
import { parse, requireActor } from '../../lib/http';
import * as settings from './settings.service';

export const settingsController = {
  list: (async (_req, res) => {
    res.json({ settings: await settings.listSettings() });
  }) satisfies RequestHandler,

  update: (async (req, res) => {
    const body = parse(updateSettingsSchema, req.body);
    res.json({
      settings: await settings.updateSettings(requireActor(req), body.values, body.reason),
    });
  }) satisfies RequestHandler,
};
