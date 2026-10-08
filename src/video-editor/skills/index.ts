// Registro das skills por etapa. Importar este módulo registra todas no orquestrador.
import { registerSkill } from '../orchestrator/orchestrator';
import { roughCutSkill, transcriptionSkill } from './cut';
import { brollSelectorSkill } from './broll';

export function registerAllSkills() {
  for (const s of [transcriptionSkill, roughCutSkill, brollSelectorSkill]) registerSkill(s);
}
registerAllSkills();
