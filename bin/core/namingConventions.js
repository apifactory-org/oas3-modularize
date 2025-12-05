// bin/core/namingConventions.js

/**
 * Utilidades para convenciones de nombres y generación de nombres
 * de archivos/identificadores de componentes.
 */

/**
 * Convierte una cadena a un array de palabras
 * Detecta: CamelCase, snake_case, kebab-case, espacios
 */
function toWords(name) {
  if (!name || typeof name !== 'string') return [];

  // Reemplaza separadores comunes
  let str = name
    .replace(/([a-z])([A-Z])/g, '$1 $2') // CamelCase → spaces
    .replace(/_/g, ' ') // snake_case → spaces
    .replace(/-/g, ' ') // kebab-case → spaces
    .toLowerCase()
    .trim();

  return str.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Aplica una convención de nombre
 * @param {string} name - Nombre original
 * @param {string} convention - Convención: PascalCase, camelCase, snake_case, kebab-case, lowercase, UPPERCASE
 * @returns {string} - Nombre con la convención aplicada
 */
function applyNamingConvention(name, convention = 'PascalCase') {
  if (!name || typeof name !== 'string') return '';

  const words = toWords(name);
  if (words.length === 0) return name;

  switch (convention) {
    case 'PascalCase':
      return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

    case 'camelCase':
      return (
        words[0].toLowerCase() +
        words
          .slice(1)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join('')
      );

    case 'snake_case':
      return words.join('_');

    case 'kebab-case':
      return words.join('-');

    case 'lowercase':
      return words.join('');

    case 'UPPERCASE':
      return words.join('_').toUpperCase();

    default:
      console.warn(`⚠️  Convención desconocida: ${convention}, usando PascalCase`);
      return applyNamingConvention(name, 'PascalCase');
  }
}

/**
 * Aplica prefijos y sufijos a un nombre de forma idempotente:
 * - No repite el prefijo si ya empieza con él
 * - No repite el sufijo si ya termina con él
 * @param {string} name - Nombre con convención ya aplicada
 * @param {string} prefix - Prefijo (ej: "CR", "Party")
 * @param {string} suffix - Sufijo (ej: "Schema", "Request")
 * @returns {string}
 */
function applyAffixes(name, prefix = '', suffix = '') {
  if (!name || typeof name !== 'string') return '';

  let result = name;

  if (prefix && typeof prefix === 'string' && prefix.length > 0) {
    // Evitar duplicar prefijo (idempotente)
    if (!result.startsWith(prefix)) {
      result = prefix + result;
    }
  }

  if (suffix && typeof suffix === 'string' && suffix.length > 0) {
    // Evitar duplicar sufijo (idempotente)
    if (!result.endsWith(suffix)) {
      result = result + suffix;
    }
  }

  return result;
}

/**
 * Valida que una convención sea válida
 * @param {string} convention - Convención a validar
 * @returns {boolean}
 */
function isValidConvention(convention) {
  const valid = ['PascalCase', 'camelCase', 'snake_case', 'kebab-case', 'lowercase', 'UPPERCASE'];
  return valid.includes(convention);
}

/**
 * Aplica convención completa: nombre → convención → prefijo/sufijo
 * @param {string} name - Nombre original
 * @param {string} convention - Convención (PascalCase, camelCase, etc)
 * @param {string} prefix - Prefijo opcional
 * @param {string} suffix - Sufijo opcional
 * @returns {string} - Nombre final con todo aplicado
 */
function applyFullNaming(name, convention = 'PascalCase', prefix = '', suffix = '') {
  if (!name || typeof name !== 'string') return '';

  // 1. Aplicar convención de nombres
  let result = applyNamingConvention(name, convention);

  // 2. Aplicar prefijo y sufijo (idempotentes)
  result = applyAffixes(result, prefix, suffix);

  return result;
}

/**
 * Sanitiza un string para ser usado como base de nombre de componente / archivo.
 * - Elimina caracteres raros
 * - Colapsa guiones
 * - Limpia guiones iniciales/finales
 */
function sanitizeComponentName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-') // cualquier cosa rara → '-'
    .replace(/-+/g, '-') // colapsar múltiples '-'
    .replace(/^-+|-+$/g, ''); // quitar '-' al inicio/fin
}

/**
 * Genera el nombre FINAL de archivo para componentes:
 *   - Sanitiza el nombre original
 *   - Aplica naming.components (convención)
 *   - Aplica prefijos/sufijos de affixes (idempotentes)
 *   - Respeta reglas especiales (responses NO se transforman aquí)
 *
 * @param {string} name           Nombre lógico del componente (clave en components.X)
 * @param {string} type           Tipo de componente: schemas, responses, requestBodies, etc.
 * @param {object} namingConfig   Sección naming del config (naming.components, etc.)
 * @param {object} affixesConfig  Sección affixes del config (prefixes/suffixes por tipo)
 * @returns {string}              Nombre de archivo SIN extensión (ej: "UserSchema")
 */
function generateComponentFilename(name, type, namingConfig = {}, affixesConfig = {}) {
  if (!name || typeof name !== 'string') return '';

  // Responses: los nombres ya los normaliza responseNaming;
  // aquí NO los tocamos, para evitar desalinear refs.
  if (type === 'responses') {
    return name;
  }

  // 1. Sanitizar base
  const cleanBase = sanitizeComponentName(name);

  // 2. Aplicar convención de nombres
  const convention = namingConfig.components || 'PascalCase';
  let fileName = applyNamingConvention(cleanBase, convention);

  // 3. Aplicar prefijos y sufijos si están habilitados (idempotentes)
  if (affixesConfig && affixesConfig.enabled) {
    const prefix = (affixesConfig.prefixes && affixesConfig.prefixes[type]) || '';
    const suffix = (affixesConfig.suffixes && affixesConfig.suffixes[type]) || '';
    fileName = applyAffixes(fileName, prefix, suffix);
  }

  return fileName;
}

module.exports = {
  toWords,
  applyNamingConvention,
  isValidConvention,
  applyAffixes,
  applyFullNaming,
  sanitizeComponentName,
  generateComponentFilename,
};
