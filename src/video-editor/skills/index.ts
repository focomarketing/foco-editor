// Registro das skills por etapa. Importar este módulo registra todas no orquestrador.
// A ordem importa dentro da etapa: os takes do usuário vêm antes das imagens de acervo,
// que só preenchem os trechos que sobraram.
import { registerSkill } from '../orchestrator/orchestrator';
import { roughCutSkill, transcriptionSkill } from './cut';
import { brollSelectorSkill } from './broll';
import { interviewBrollSkill } from './interview';
import { scriptToVideoSkill } from './script';
import { motionDesignerSkill } from './motion';
import { transitionDesignerSkill } from './transitions';

export function registerAllSkills() {
  for (const s of [transcriptionSkill, roughCutSkill, interviewBrollSkill, scriptToVideoSkill, brollSelectorSkill, transitionDesignerSkill, motionDesignerSkill]) registerSkill(s);
}
registerAllSkills();
