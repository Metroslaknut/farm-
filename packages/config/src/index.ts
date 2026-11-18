/**
 * Client-safe configuration: constants only. Must stay free of Node APIs and
 * secrets because Web and Mobile import this entry point.
 * Server-only env loading lives in `@farmplus/config/server`.
 */
export const APP_NAME = 'FARM+';
export const API_PREFIX = '/api/v1';
export const DEFAULT_API_PORT = 4000;
export const DEFAULT_WEB_PORT = 5173;

export const APP_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
