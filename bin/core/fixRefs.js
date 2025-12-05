/**
 * =============================================================================
 * FIX-REFS.JS — Corrector de Referencias $ref para OpenAPI Modularizado
 * =============================================================================
 *
 * PROPÓSITO:
 * ----------
 * Transforma las referencias internas de OpenAPI (`$ref`) de formato canónico
 * a rutas relativas de archivos físicos, usando los mappings generados por
 * transform.js.
 *
 * FIRMA:
 * ------
 * fixRefs(content, componentType, config, mappings)
 *
 * Donde:
 *   - config: { mainFileName, naming, affixes }
 *   - mappings: { schemaMapping, responseMapping }
 *
 * =============================================================================
 */

const { applyNamingConvention } = require('./namingConventions');

// =============================================================================
// CONSTANTES
// =============================================================================

const COMPONENT_TYPES = [
  'schemas', 'responses', 'requestBodies', 'parameters',
  'headers', 'securitySchemes', 'examples', 'links', 'callbacks',
];

const SCHEMA_LIKE_FOLDERS = [
  'schemas', 'properties', 'enums', 'arrays', 'composites',
];

const REF_PATTERN = /"#\/components\/([a-zA-Z]+)\/([^"]+)"/g;

// =============================================================================
// UTILIDADES
// =============================================================================

function generateFileName(itemName, componentType, namingConfig, affixesConfig) {
  const convention = namingConfig?.components || 'PascalCase';
  let fileName = applyNamingConvention(itemName, convention);

  if (affixesConfig?.enabled) {
    const prefix = affixesConfig.prefixes?.[componentType] || '';
    const suffix = affixesConfig.suffixes?.[componentType] || '';
    if (prefix) fileName = prefix + fileName;
    if (suffix && !fileName.endsWith(suffix)) fileName = fileName + suffix;
  }

  return fileName;
}

function getRelativePath(fromType, toFolder) {
  if (fromType === 'paths') {
    return `../components/${toFolder}`;
  }
  return `../${toFolder}`;
}

function isSchemaLikeFolder(componentType) {
  return SCHEMA_LIKE_FOLDERS.includes(componentType);
}

function normalizeKey(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[_-]+/g, '').toLowerCase();
}

function buildCaseInsensitiveIndex(mapping) {
  if (!mapping) return null;
  const idx = new Map();
  for (const [rawName, meta] of Object.entries(mapping)) {
    idx.set(normalizeKey(rawName), meta);
  }
  return idx;
}

function resolveFromMapping(name, mapping, ciIndex) {
  if (!mapping) return null;
  
  if (mapping[name]) return mapping[name];
  
  const key = normalizeKey(name);
  if (ciIndex?.has(key)) return ciIndex.get(key);
  
  return null;
}

// =============================================================================
// TRANSFORMADORES
// =============================================================================

function transformPathRefs(contentString, mainFileName) {
  return contentString.replace(
    /"#\/components\/([^"]+)"/g,
    (_match, rest) => `"../${mainFileName}.yaml#/components/${rest}"`
  );
}

function transformRefs(contentString, fromFolder, config, mappings) {
  const { schemaMapping, responseMapping } = mappings;
  const schemaCiIndex = buildCaseInsensitiveIndex(schemaMapping);
  const responseCiIndex = buildCaseInsensitiveIndex(responseMapping);
  const { naming, affixes } = config;

  return contentString.replace(REF_PATTERN, (match, targetType, name) => {
    
    // Referencias a schemas
    if (targetType === 'schemas') {
      const target = resolveFromMapping(name, schemaMapping, schemaCiIndex);
      if (target) {
        const { folder, fileName } = target;
        const relativePath = getRelativePath(fromFolder, folder);
        return `"${relativePath}/${fileName}.yaml"`;
      }
      const fileName = generateFileName(name, 'schemas', naming, affixes);
      const relativePath = getRelativePath(fromFolder, 'schemas');
      return `"${relativePath}/${fileName}.yaml"`;
    }

    // Referencias a responses
    if (targetType === 'responses') {
      const target = resolveFromMapping(name, responseMapping, responseCiIndex);
      if (target) {
        const { folder, fileName } = target;
        const relativePath = getRelativePath(fromFolder, folder || 'responses');
        return `"${relativePath}/${fileName}.yaml"`;
      }
      const relativePath = getRelativePath(fromFolder, 'responses');
      return `"${relativePath}/${name}.yaml"`;
    }

    // Otros tipos de componentes
    const fileName = generateFileName(name, targetType, naming, affixes);
    const relativePath = getRelativePath(fromFolder, targetType);
    return `"${relativePath}/${fileName}.yaml"`;
  });
}

// =============================================================================
// FUNCIÓN PRINCIPAL
// =============================================================================

/**
 * Corrige las referencias $ref en un objeto OpenAPI.
 *
 * @param {Object} content - Contenido a procesar
 * @param {string} componentType - Tipo/carpeta de origen ('paths', 'schemas', etc.)
 * @param {Object} config - Configuración unificada
 * @param {string} config.mainFileName - Nombre del entrypoint (default: 'main')
 * @param {Object} config.naming - { components: 'PascalCase', paths: 'kebab-case' }
 * @param {Object} config.affixes - { enabled: true, prefixes: {}, suffixes: {} }
 * @param {Object} mappings - Mappings generados por transform.js
 * @param {Object} mappings.schemaMapping - { name: { folder, fileName } }
 * @param {Object} mappings.responseMapping - { name: { folder, fileName } }
 *
 * @returns {Object} Contenido con referencias corregidas
 */
function fixRefs(content, componentType, config = {}, mappings = {}) {
  
  // Validaciones
  if (!content || typeof content !== 'object') {
    return content;
  }

  const finalConfig = {
    mainFileName: config.mainFileName || 'main',
    naming: config.naming || {},
    affixes: config.affixes || {},
  };

  const finalMappings = {
    schemaMapping: mappings.schemaMapping || null,
    responseMapping: mappings.responseMapping || null,
  };

  // Serializar
  let contentString;
  try {
    contentString = JSON.stringify(content);
  } catch (error) {
    console.error('[fixRefs] Error serializando:', error.message);
    return content;
  }

  // Transformar según tipo de origen
  if (componentType === 'paths') {
    contentString = transformPathRefs(contentString, finalConfig.mainFileName);
  } else {
    contentString = transformRefs(contentString, componentType, finalConfig, finalMappings);
  }

  // Deserializar
  try {
    return JSON.parse(contentString);
  } catch (error) {
    console.error('[fixRefs] Error deserializando:', error.message);
    return content;
  }
}

// =============================================================================
// BUILD SCHEMA MAPPING
// =============================================================================

/**
 * Construye el schemaMapping a partir de los schemas.
 * NOTA: Esta función también existe en transform.js.
 *       Se mantiene aquí para compatibilidad.
 */
function buildSchemaMapping(schemas, classifySchema, config) {
  if (!schemas || !config.schemaClassification?.enabled) {
    return null;
  }

  const mapping = {};
  const schemaCfg = config.schemaClassification;

  for (const [name, content] of Object.entries(schemas)) {
    const schemaType = classifySchema(content);
    const folder = schemaCfg.folders?.[schemaType] || 'schemas';
    const suffix = schemaCfg.suffixes?.[schemaType] || '';

    const convention = config.naming?.components || 'PascalCase';
    let fileName = applyNamingConvention(name, convention);

    const prefix = config.affixes?.enabled ? (config.affixes.prefixes?.schemas || '') : '';
    if (prefix) fileName = prefix + fileName;
    if (suffix && !fileName.endsWith(suffix)) fileName = fileName + suffix;
    if (config.filenamePrefix) fileName = config.filenamePrefix + fileName;

    mapping[name] = { folder, fileName, type: schemaType };
  }

  return mapping;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  fixRefs,
  buildSchemaMapping,
  __internal: {
    generateFileName,
    getRelativePath,
    isSchemaLikeFolder,
    normalizeKey,
    buildCaseInsensitiveIndex,
    resolveFromMapping,
    transformPathRefs,
    transformRefs,
    COMPONENT_TYPES,
    SCHEMA_LIKE_FOLDERS,
  },
};