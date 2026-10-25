import {badRequest, forbidden} from './errors.js';
import {isPlainObject} from './mongo-syntax.js';

const FORBIDDEN_OPERATORS = new Set(['$where', '$function', '$accumulator']);
const WRITE_STAGES = new Set(['$out', '$merge']);
const MAX_STAGES = 100;

function walk(value: unknown, visit: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visit);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    visit(key);
    walk(item, visit);
  }
}

export function assertSafeExpression(value: unknown, label: string): void {
  walk(value, key => {
    if (FORBIDDEN_OPERATORS.has(key)) {
      throw badRequest(
        `${label} : l'opérateur ${key} est désactivé car il exécute du JavaScript sur le serveur.`,
      );
    }
  });
}

export function pipelineWritesData(
  pipeline: Record<string, unknown>[],
): boolean {
  return pipeline.some(stage =>
    Object.keys(stage).some(key => WRITE_STAGES.has(key)),
  );
}

export function assertSafePipeline(
  pipeline: Record<string, unknown>[],
  canWrite: boolean,
): void {
  if (pipeline.length > MAX_STAGES) {
    throw badRequest(`Le pipeline est limité à ${MAX_STAGES} étapes.`);
  }
  pipeline.forEach((stage, index) => {
    const keys = Object.keys(stage);
    if (keys.length !== 1 || !keys[0].startsWith('$')) {
      throw badRequest(
        `Étape ${index + 1} : chaque étape doit contenir exactement un opérateur, par exemple { "$match": { … } }.`,
      );
    }
    if (WRITE_STAGES.has(keys[0])) {
      if (!canWrite) {
        throw forbidden(
          `Étape ${index + 1} : ${keys[0]} écrit des données et nécessite le rôle administrateur.`,
        );
      }
      if (index !== pipeline.length - 1) {
        throw badRequest(`${keys[0]} doit être la dernière étape du pipeline.`);
      }
    }
  });
  assertSafeExpression(pipeline, 'Pipeline');
}
