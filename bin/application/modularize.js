/**
 * =============================================================================
 * MODULARIZE.JS — Modularizador de Especificaciones OpenAPI (Simplificado)
 * =============================================================================
 *
 * PROPÓSITO:
 * ----------
 * Toma un OpenAPI (original o transformado) y los mappings generados por
 * transform.js, y escribe los archivos físicos en el scaffolding correcto.
 *
 * RESPONSABILIDADES:
 * ------------------
 *   ✓ Flujo interactivo (detectar → preguntar → preview → ejecutar)
 *   ✓ Crear estructura de carpetas según scaffolding
 *   ✓ Escribir archivos en ubicación correcta según mappings
 *   ✓ Ajustar $ref a rutas relativas
 *   ✓ Generar entrypoint con referencias
 *   ✓ Validar resultado
 *
 *   ✗ NO clasifica schemas (lo hace transform.js)
 *   ✗ NO genera nombres inteligentes (lo hace transform.js)
 *   ✗ NO extrae responses inline (lo hace transform.js)
 *
 * =============================================================================
 */

const path = require('path');
const chalk = require('chalk');
const prompts = require('prompts');

const { readYamlFile, writeYamlFile } = require('../infrastructure/yamlUtils');
const { removeDirIfExists, ensureDir, fileExists } = require('../infrastructure/fileSystem');
const { slugifyPath } = require('../core/slugifyPath');
const { fixRefs } = require('../core/fixRefs');
const { applyNamingConvention } = require('../core/namingConventions');
const { validateWithRedocly } = require('./validate');
const { loadAllConfigs } = require('../infrastructure/configLoader');

// Transform
const { transform, analyze, loadScaffoldings } = require('../core/transform');
const { detectApiStyle } = require('../core/detectApiStyle');

// =============================================================================
// ESTILOS DE CONSOLA
// =============================================================================

const styles = {
  divider: () => chalk.dim('─'.repeat(70)),
  section: (t) => chalk.bold.cyan(t),
  step: (t) => chalk.cyan('  → ' + t),
  success: (t) => chalk.green('  ✓ ' + t),
  warning: (t) => chalk.yellow('  ⚠ ' + t),
  error: (t) => chalk.red('  ✖ ' + t),
  info: (t) => chalk.blue('  ℹ ' + t),
  highlight: (t) => chalk.yellow(t),
};

// =============================================================================
// FLUJO INTERACTIVO
// =============================================================================

/**
 * PASO 1: Analiza el OpenAPI y muestra estadísticas
 */
async function showAnalysis(openapi, logger) {
  const scaffoldings = loadScaffoldings();
  const { style, confidence, scores } = detectApiStyle(openapi.paths, scaffoldings);
  const analysis = analyze(openapi);

  logger.log(styles.section('\n  ANÁLISIS DEL OPENAPI'));
  logger.log(styles.divider());
  
  logger.log(styles.info(`Estilo detectado: ${styles.highlight(style.toUpperCase())} (${confidence}% confianza)`));
  
  if (Object.keys(scores).length > 1) {
    logger.log(styles.info('Scores por estilo:'));
    for (const [s, score] of Object.entries(scores).sort((a, b) => b[1] - a[1])) {
      const bar = '█'.repeat(Math.round(score / 5)) + '░'.repeat(20 - Math.round(score / 5));
      logger.log(`      ${s.padEnd(12)} ${bar} ${score}%`);
    }
  }

  logger.log('');
  logger.log(styles.info(`Paths: ${analysis.pathsCount}`));
  logger.log(styles.info(`Schemas: ${analysis.schemasCount}`));
  if (analysis.schemasCount > 0) {
    const { schemasByType } = analysis;
    logger.log(`      ├── objects:    ${schemasByType.objects}`);
    logger.log(`      ├── enums:      ${schemasByType.enums}`);
    logger.log(`      ├── arrays:     ${schemasByType.arrays}`);
    logger.log(`      ├── properties: ${schemasByType.properties}`);
    logger.log(`      └── composites: ${schemasByType.composites}`);
  }
  logger.log(styles.info(`Responses en components: ${analysis.existingResponsesCount}`));
  logger.log(styles.info(`Responses inline (extraíbles): ${analysis.inlineResponsesCount}`));
  logger.log(styles.info(`RequestBodies: ${analysis.requestBodiesCount}`));
  logger.log(styles.info(`Parameters: ${analysis.parametersCount}`));

  return { detectedStyle: style, confidence, analysis };
}

/**
 * PASO 2: Pregunta qué scaffolding usar
 */
async function askScaffolding(detectedStyle, confidence) {
  const scaffoldings = loadScaffoldings();
  const choices = Object.entries(scaffoldings).map(([name, config]) => ({
    title: name === detectedStyle 
      ? `${name} (recomendado - ${confidence}% match)`
      : name,
    value: name,
    description: config.description,
  }));

  // Mover el recomendado al inicio
  const recommended = choices.find(c => c.value === detectedStyle);
  const others = choices.filter(c => c.value !== detectedStyle);
  
  const response = await prompts({
    type: 'select',
    name: 'scaffolding',
    message: '¿Qué scaffolding deseas aplicar?',
    choices: [recommended, ...others].filter(Boolean),
    initial: 0,
  });

  return response.scaffolding;
}

/**
 * PASO 3: Muestra preview de transformaciones
 */
async function showPreview(transformResult, scaffoldingName, logger) {
  const { schemaMapping, responseMapping, stats } = transformResult;

  logger.log(styles.section(`\n  PREVIEW DE TRANSFORMACIONES (${scaffoldingName.toUpperCase()})`));
  logger.log(styles.divider());

  // Schemas
  const schemaEntries = Object.entries(schemaMapping).slice(0, 5);
  if (schemaEntries.length > 0) {
    logger.log(styles.info('Schemas:'));
    for (const [original, mapping] of schemaEntries) {
      logger.log(`      ${original} → ${mapping.folder}/${mapping.fileName}`);
    }
    if (Object.keys(schemaMapping).length > 5) {
      logger.log(`      ... (${Object.keys(schemaMapping).length - 5} más)`);
    }
  }

  // Responses
  const responseEntries = Object.entries(responseMapping).slice(0, 5);
  if (responseEntries.length > 0) {
    logger.log('');
    logger.log(styles.info('Responses:'));
    for (const [name, mapping] of responseEntries) {
      const source = mapping.original ? `(de ${mapping.original})` : '(inline)';
      logger.log(`      ${name} ${source}`);
    }
    if (Object.keys(responseMapping).length > 5) {
      logger.log(`      ... (${Object.keys(responseMapping).length - 5} más)`);
    }
  }

  logger.log('');
  logger.log(styles.info('Resumen:'));
  logger.log(`      Schemas a clasificar: ${stats.schemasClassified}`);
  logger.log(`      Responses a extraer:  ${stats.responsesExtracted}`);
  logger.log(`      Responses a renombrar: ${stats.responsesNormalized}`);

  const confirm = await prompts({
    type: 'confirm',
    name: 'continue',
    message: '¿Continuar con estas transformaciones?',
    initial: true,
  });

  return confirm.continue;
}

// =============================================================================
// ESCRITURA DE ARCHIVOS
// =============================================================================

/**
 * Escribe los schemas según el mapping
 */
function writeSchemas(schemas, schemaMapping, responseMapping, config, logger) {
  const { outputDir, fileExtension, indent, naming, mainFileName } = config;
  const componentsDir = path.join(outputDir, 'components');
  const createdFolders = new Set();
  let count = 0;

  const fixRefsConfig = { mainFileName, naming, affixes: config.affixes || {} };
  const mappings = { schemaMapping, responseMapping };

  for (const [name, schema] of Object.entries(schemas || {})) {
    const mapping = schemaMapping[name];
    if (!mapping) continue;

    const { folder, fileName } = mapping;
    const folderPath = path.join(componentsDir, folder);

    if (!createdFolders.has(folder)) {
      ensureDir(folderPath);
      createdFolders.add(folder);
    }

    const filePath = path.join(folderPath, fileName + fileExtension);
    
    // Ajustar $refs internos
    const finalContent = fixRefs(schema, folder, fixRefsConfig, mappings);
    
    writeYamlFile(filePath, finalContent, { indent });
    count++;
  }

  logger.log(styles.success(`${count} schemas escritos`));
  return { count, folders: Array.from(createdFolders) };
}

/**
 * Escribe los responses según el mapping
 */
function writeResponses(responses, schemaMapping, responseMapping, config, logger) {
  const { outputDir, fileExtension, indent, naming, mainFileName } = config;
  const responsesDir = path.join(outputDir, 'components', 'responses');
  ensureDir(responsesDir);
  let count = 0;

  const fixRefsConfig = { mainFileName, naming, affixes: config.affixes || {} };
  const mappings = { schemaMapping, responseMapping };

  for (const [name, response] of Object.entries(responses || {})) {
    const mapping = responseMapping[name];
    const fileName = mapping?.fileName || name;
    const filePath = path.join(responsesDir, fileName + fileExtension);

    const finalContent = fixRefs(response, 'responses', fixRefsConfig, mappings);
    
    writeYamlFile(filePath, finalContent, { indent });
    count++;
  }

  logger.log(styles.success(`${count} responses escritos`));
  return count;
}

/**
 * Escribe los paths
 */
function writePaths(paths, schemaMapping, responseMapping, config, logger) {
  const { outputDir, fileExtension, indent, naming, mainFileName } = config;
  const pathsDir = path.join(outputDir, 'paths');
  ensureDir(pathsDir);
  let count = 0;

  const fixRefsConfig = { mainFileName, naming, affixes: config.affixes || {} };
  const mappings = { schemaMapping, responseMapping };

  for (const [route, pathObj] of Object.entries(paths || {})) {
    const slugified = slugifyPath(route).replace(/\.yaml$/, '');
    const convention = naming?.paths || 'kebab-case';
    const fileName = applyNamingConvention(slugified, convention);
    const filePath = path.join(pathsDir, fileName + fileExtension);

    const finalContent = fixRefs(pathObj, 'paths', fixRefsConfig, mappings);
    
    writeYamlFile(filePath, finalContent, { indent });
    count++;
  }

  logger.log(styles.success(`${count} paths escritos`));
  return count;
}

/**
 * Escribe otros components (requestBodies, parameters, etc.)
 */
function writeOtherComponents(components, schemaMapping, responseMapping, config, logger) {
  const { outputDir, fileExtension, indent, naming, mainFileName } = config;
  const componentsDir = path.join(outputDir, 'components');
  const types = ['requestBodies', 'parameters', 'headers', 'securitySchemes', 'examples'];
  const stats = {};

  const fixRefsConfig = { mainFileName, naming, affixes: config.affixes || {} };
  const mappings = { schemaMapping, responseMapping };

  for (const type of types) {
    const items = components?.[type];
    if (!items || Object.keys(items).length === 0) continue;

    const typeDir = path.join(componentsDir, type);
    ensureDir(typeDir);
    stats[type] = 0;

    for (const [name, content] of Object.entries(items)) {
      const filePath = path.join(typeDir, name + fileExtension);
      const finalContent = fixRefs(content, type, fixRefsConfig, mappings);
      writeYamlFile(filePath, finalContent, { indent });
      stats[type]++;
    }

    logger.log(styles.success(`${stats[type]} ${type} escritos`));
  }

  return stats;
}

/**
 * Genera el entrypoint principal
 */
function writeEntrypoint(openapi, schemaMapping, responseMapping, config, logger) {
  const { outputDir, mainFileName, fileExtension, indent } = config;
  const mainFile = path.join(outputDir, mainFileName + fileExtension);

  // Construir refs para paths
  const pathRefs = {};
  for (const route of Object.keys(openapi.paths || {})) {
    const slugified = slugifyPath(route).replace(/\.yaml$/, '');
    const convention = config.naming?.paths || 'kebab-case';
    const fileName = applyNamingConvention(slugified, convention);
    pathRefs[route] = { $ref: `./paths/${fileName}${fileExtension}` };
  }

  // Construir refs para schemas
  const schemaRefs = {};
  for (const [name, mapping] of Object.entries(schemaMapping)) {
    schemaRefs[name] = { $ref: `./components/${mapping.folder}/${mapping.fileName}${fileExtension}` };
  }

  // Construir refs para responses
  const responseRefs = {};
  for (const [name, mapping] of Object.entries(responseMapping)) {
    const fileName = mapping.fileName || name;
    responseRefs[name] = { $ref: `./components/responses/${fileName}${fileExtension}` };
  }

  // Construir refs para otros components
  const componentRefs = { schemas: schemaRefs, responses: responseRefs };
  const otherTypes = ['requestBodies', 'parameters', 'headers', 'securitySchemes', 'examples'];
  
  for (const type of otherTypes) {
    const items = openapi.components?.[type];
    if (items && Object.keys(items).length > 0) {
      componentRefs[type] = {};
      for (const name of Object.keys(items)) {
        componentRefs[type][name] = { $ref: `./components/${type}/${name}${fileExtension}` };
      }
    }
  }

  const entrypoint = {
    openapi: openapi.openapi,
    info: openapi.info,
    servers: openapi.servers || [],
    tags: openapi.tags || [],
    security: openapi.security || [],
    ...(openapi.externalDocs && { externalDocs: openapi.externalDocs }),
    paths: pathRefs,
    components: componentRefs,
  };

  // Copiar extensiones x-*
  for (const [key, val] of Object.entries(openapi)) {
    if (key.startsWith('x-')) entrypoint[key] = val;
  }

  writeYamlFile(mainFile, entrypoint, { indent });
  logger.log(styles.success(`Entrypoint generado: ${mainFileName}${fileExtension}`));
  
  return mainFile;
}

// =============================================================================
// FUNCIÓN PRINCIPAL
// =============================================================================

/**
 * Modulariza un OpenAPI con flujo interactivo
 */
async function modularize(inputPath, options = {}) {
  const logger = options.logger || console;
  const config = loadAllConfigs().modularize || {};
  
  const finalConfig = {
    outputDir: path.normalize(options.output || config.paths?.output || './src'),
    mainFileName: config.paths?.mainFileName || 'main',
    fileExtension: config.advanced?.fileExtension || '.yaml',
    indent: config.advanced?.indent || 2,
    naming: config.naming || { components: 'PascalCase', paths: 'kebab-case' },
    affixes: config.affixes || { enabled: false },
    cleanOutputDir: config.behavior?.cleanOutputDir !== false,
    validateAfter: config.behavior?.validateAfterModularize !== false,
  };

  logger.log('\n' + styles.divider());
  logger.log(styles.section('  MODULARIZACIÓN DE OPENAPI'));
  logger.log(styles.divider());

  // 1. Leer archivo
  logger.log(styles.step(`Leyendo: ${inputPath}`));
  if (!fileExists(inputPath)) {
    throw new Error(`Archivo no encontrado: ${inputPath}`);
  }
  const openapi = readYamlFile(inputPath);

  // 2. Análisis
  const { detectedStyle, confidence } = await showAnalysis(openapi, logger);

  // 3. Selección de scaffolding (interactivo o por opción)
  let scaffoldingName;
  if (options.scaffolding) {
    scaffoldingName = options.scaffolding;
    logger.log(styles.info(`Scaffolding: ${scaffoldingName} (especificado por opción)`));
  } else if (options.yes) {
    scaffoldingName = detectedStyle;
    logger.log(styles.info(`Scaffolding: ${scaffoldingName} (auto-seleccionado)`));
  } else {
    scaffoldingName = await askScaffolding(detectedStyle, confidence);
    if (!scaffoldingName) {
      logger.log(styles.warning('Operación cancelada'));
      return { success: false, cancelled: true };
    }
  }

  // 4. Transformar
  logger.log(styles.step('Aplicando transformaciones...'));
  const transformResult = transform(openapi, {
    scaffolding: scaffoldingName,
    style: scaffoldingName,
    namingConfig: finalConfig.naming,
  });

  // 5. Preview (si no es --yes)
  if (!options.yes && !options.dryRun) {
    const proceed = await showPreview(transformResult, scaffoldingName, logger);
    if (!proceed) {
      logger.log(styles.warning('Operación cancelada'));
      return { success: false, cancelled: true };
    }
  }

  // 6. Dry run - solo mostrar, no escribir
  if (options.dryRun) {
    logger.log(styles.info('Modo dry-run: no se escribieron archivos'));
    return { success: true, dryRun: true, transformResult };
  }

  // 7. Limpiar output si existe
  if (fileExists(finalConfig.outputDir) && finalConfig.cleanOutputDir) {
    if (!options.yes) {
      const confirm = await prompts({
        type: 'confirm',
        name: 'clean',
        message: `¿Limpiar carpeta ${finalConfig.outputDir}?`,
        initial: true,
      });
      if (!confirm.clean) {
        logger.log(styles.warning('Operación cancelada'));
        return { success: false, cancelled: true };
      }
    }
    removeDirIfExists(finalConfig.outputDir);
  }

  // 8. Crear estructura
  logger.log(styles.section('\n  ESCRIBIENDO ARCHIVOS'));
  ensureDir(finalConfig.outputDir);

  const { openapi: transformed, schemaMapping, responseMapping } = transformResult;

  // 9. Escribir archivos
  writeSchemas(transformed.components?.schemas, schemaMapping, responseMapping, finalConfig, logger);
  writeResponses(transformed.components?.responses, schemaMapping, responseMapping, finalConfig, logger);
  writePaths(transformed.paths, schemaMapping, responseMapping, finalConfig, logger);
  writeOtherComponents(transformed.components, schemaMapping, responseMapping, finalConfig, logger);
  
  const mainFile = writeEntrypoint(transformed, schemaMapping, responseMapping, finalConfig, logger);

  // 10. Validar
  if (finalConfig.validateAfter) {
    logger.log(styles.section('\n  VALIDANDO'));
    await validateWithRedocly(mainFile);
  }

  // 11. Resumen final
  logger.log('\n' + styles.divider());
  logger.log(chalk.green.bold('  ✓ MODULARIZACIÓN COMPLETADA'));
  logger.log(styles.divider());
  logger.log(styles.info(`Scaffolding: ${scaffoldingName}`));
  logger.log(styles.info(`Carpeta: ${finalConfig.outputDir}`));
  logger.log('');

  return {
    success: true,
    scaffolding: scaffoldingName,
    outputDir: finalConfig.outputDir,
    mainFile,
    stats: transformResult.stats,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  modularize,
  showAnalysis,
  askScaffolding,
  showPreview,
};