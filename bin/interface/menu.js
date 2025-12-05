// bin/interface/menu.js

/**
 * =============================================================================
 * MENU.JS — Interfaz de menú interactivo para OpenAPI Builder
 * =============================================================================
 *
 * ACCIONES DISPONIBLES:
 * ---------------------
 *   1. Modularizar OAS3.x    → Divide especificación (con scaffolding)
 *   2. Transformar OAS3.x    → Aplica transformaciones sin modularizar
 *   3. Consolidar OAS3.x     → Une archivos modulares en un bundle
 *   4. Generar Documentación → Crea documentación Markdown
 *   5. Exportar Swagger 2.0  → Convierte OAS3.x a Swagger 2.0
 *   ESC. Salir               → Cierra la aplicación
 *
 * =============================================================================
 */

const prompts = require('prompts');
const chalk = require('chalk');

// --- Infraestructura ---
const { loadAllConfigs } = require('../infrastructure/configLoader');
const { getVersionDisplay } = require('../infrastructure/version');
const { fileExists } = require('../infrastructure/fileSystem');
const { readYamlFile, writeYamlFile } = require('../infrastructure/yamlUtils');

// --- Aplicación ---
const { modularize } = require('../application/modularize');
const { createBundleGenerator } = require('../application/bundle');
const { generateMarkdownDocs } = require('../application/docs');
const { downgradeToSwagger2, buildDefaultSwagger2Output } = require('../application/downgradeSwagger2');

// --- Core ---
const { transform, analyze, loadScaffoldings } = require('../core/transform');
const { detectApiStyle } = require('../core/detectApiStyle');

// ---------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------
const configs = loadAllConfigs();

const C = {
  modularizeInput: configs.modularize?.paths?.input,
  modularizeOutput: configs.modularize?.paths?.output,
  mainFileName: configs.modularize?.paths?.mainFileName || 'main',
  fileExtension: configs.modularize?.advanced?.fileExtension || '.yaml',
  bundleOutput: configs.bundle?.paths?.bundleOutput,
  docsOutput: configs.docs?.paths?.output,
  swagger2Input: configs.swagger2?.paths?.input,
  swagger2Output: configs.swagger2?.paths?.output,
};

const MAIN_FILE = C.modularizeOutput
  ? `${C.modularizeOutput}/${C.mainFileName}${C.fileExtension}`
  : './src/main.yaml';

// ---------------------------------------------------------------
// ESTILOS
// ---------------------------------------------------------------

const styles = {
  header: (text) => chalk.bold.hex('#F58C34')(text),
  success: (text) => chalk.green('✅ ' + text),
  error: (text) => chalk.red('❌ ' + text),
  info: (text) => chalk.cyan('ℹ️  ' + text),
  warn: (text) => chalk.yellow('⚠️  ' + text),
  help: (text) => chalk.dim.italic(text),
  divider: () => chalk.dim('─'.repeat(70)),
  section: (text) => chalk.bold.cyan(text),
  highlight: (text) => chalk.yellow(text),
};

const promptsConfig = {
  onState: () => {},
};

function printResult(message, type = 'success') {
  const styleMap = {
    success: styles.success,
    error: styles.error,
    info: styles.info,
    warn: styles.warn,
  };
  console.log('\n' + (styleMap[type] || styles.info)(message) + '\n');
}

async function pause() {
  // Simplemente esperar Enter, sin confirm de Y/n
  await prompts(
    {
      type: 'text',
      name: 'continue',
      message: 'Presiona enter para volver al menú',
    },
    promptsConfig
  );
}

// ---------------------------------------------------------------
// ACCIÓN 1: MODULARIZAR (con detección y scaffolding)
// ---------------------------------------------------------------

async function actionModularize() {
  console.log('\n' + styles.divider());
  console.log(styles.section('  MODULARIZAR OAS3.x'));
  console.log(styles.divider());

  // 1. Preguntar ruta de entrada
  const inputResp = await prompts(
    {
      type: 'text',
      name: 'inputPath',
      message: 'Ruta del archivo OAS3.x',
      initial: C.modularizeInput || './api/openapi.yaml',
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!inputResp.inputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  if (!fileExists(inputResp.inputPath)) {
    throw new Error(`Archivo no encontrado: ${inputResp.inputPath}`);
  }

  // 2. Leer y analizar
  console.log(styles.info('Analizando archivo...'));
  const openapi = readYamlFile(inputResp.inputPath);
  const scaffoldings = loadScaffoldings();
  const { style, confidence, scores } = detectApiStyle(openapi.paths, scaffoldings);
  const analysis = analyze(openapi);

  // 3. Mostrar análisis
  console.log('\n' + styles.section('  ANÁLISIS'));
  console.log(styles.divider());
  console.log(
    styles.info(
      `Estilo detectado: ${styles.highlight(style.toUpperCase())} (${confidence}% confianza)`
    )
  );

  if (Object.keys(scores).length > 1) {
    console.log(styles.info('Scores:'));
    for (const [s, score] of Object.entries(scores).sort((a, b) => b[1] - a[1])) {
      const bar = '█'.repeat(Math.round(score / 5)) + '░'.repeat(20 - Math.round(score / 5));
      console.log(`      ${s.padEnd(12)} ${bar} ${score}%`);
    }
  }

  console.log('');
  console.log(styles.info(`Paths: ${analysis.pathsCount}`));
  console.log(styles.info(`Schemas: ${analysis.schemasCount}`));
  if (analysis.schemasCount > 0) {
    const t = analysis.schemasByType;
    console.log(
      `      objects: ${t.objects}, enums: ${t.enums}, arrays: ${t.arrays}, properties: ${t.properties}, composites: ${t.composites}`
    );
  }
  console.log(styles.info(`Responses inline (extraíbles): ${analysis.inlineResponsesCount}`));

  // 4. Seleccionar scaffolding (lista intuitiva con nombres)
  const choices = Object.entries(scaffoldings).map(([name, cfg]) => ({
    title: name === style ? `${name} ${chalk.green('(recomendado)')}` : name,
    value: name,
    description: cfg.description,
  }));

  if (choices.length === 0) {
    console.log('');
    console.log(
      styles.warn(
        'No se encontraron scaffoldings definidos. Revisa config/scaffoldings.yaml o la función loadScaffoldings().'
      )
    );
    return;
  }

  console.log('');
  const scaffResp = await prompts(
    {
      type: 'select',
      name: 'scaffolding',
      message: '¿Qué scaffolding deseas aplicar?',
      choices,
      initial: 0,
    },
    promptsConfig
  );

  if (!scaffResp.scaffolding) {
    throw new Error('Operación cancelada por el usuario');
  }

  const scaffoldingName = scaffResp.scaffolding;

  // 5. Preguntar carpeta de salida
  const outputResp = await prompts(
    {
      type: 'text',
      name: 'outputPath',
      message: 'Carpeta de salida',
      initial: C.modularizeOutput || './src',
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!outputResp.outputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  // 6. Ejecutar modularización (sin más preguntas internas)
  const result = await modularize(inputResp.inputPath, {
    scaffolding: scaffoldingName,
    output: outputResp.outputPath,
    yes: true, // ya confirmamos scaffolding y salida arriba
  });

  if (result.success) {
    printResult(`Modularización completada en ${result.outputDir}`, 'success');
  }
}

// ---------------------------------------------------------------
// ACCIÓN 2: CONSOLIDAR (BUNDLE)
// ---------------------------------------------------------------

async function actionBundle() {
  console.log('\n' + styles.divider());
  console.log(styles.section('  CONSOLIDAR OAS3.x (BUNDLE)'));
  console.log(styles.divider());

  const inputResp = await prompts(
    {
      type: 'text',
      name: 'inputPath',
      message: 'Archivo modular principal (entrypoint)',
      initial: MAIN_FILE,
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!inputResp.inputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  const outputResp = await prompts(
    {
      type: 'text',
      name: 'outputPath',
      message: 'Ruta de salida del Bundle',
      initial: C.bundleOutput || './dist/bundle.yaml',
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!outputResp.outputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  const bundler = createBundleGenerator();
  await bundler.generate(inputResp.inputPath, outputResp.outputPath);

  printResult(`Bundle generado: ${outputResp.outputPath}`, 'success');
}

// ---------------------------------------------------------------
// ACCIÓN 3: TRANSFORMAR (sin modularizar)
// ---------------------------------------------------------------

async function actionTransform() {
  console.log('\n' + styles.divider());
  console.log(styles.section('  TRANSFORMAR OAS3.x'));
  console.log(styles.help('  Aplica transformaciones de nombres sin modularizar'));
  console.log(styles.divider());

  // 1. Archivo de entrada
  const inputResp = await prompts(
    {
      type: 'text',
      name: 'inputPath',
      message: 'Archivo OAS3.x de entrada',
      initial: C.modularizeInput || './api/openapi.yaml',
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!inputResp.inputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  if (!fileExists(inputResp.inputPath)) {
    throw new Error(`Archivo no encontrado: ${inputResp.inputPath}`);
  }

  // 2. Leer y detectar estilo
  console.log(styles.info('Analizando archivo...'));
  const openapi = readYamlFile(inputResp.inputPath);
  const scaffoldings = loadScaffoldings();
  const { style, confidence } = detectApiStyle(openapi.paths, scaffoldings);

  console.log(
    styles.info(
      `Estilo detectado: ${styles.highlight(style.toUpperCase())} (${confidence}%)`
    )
  );

  // 3. Seleccionar scaffolding para transformación (lista)
  const choices = Object.entries(scaffoldings)
    .filter(([name]) => name !== 'conservador') // si ese estilo no transforma nada
    .map(([name, cfg]) => ({
      title:
        name === style ? `${name} ${chalk.green('(detectado)')}` : name,
      value: name,
      description: cfg.description,
    }));

  if (choices.length === 0) {
    console.log('');
    console.log(
      styles.warn(
        'No se encontraron estilos de transformación. Revisa config/scaffoldings.yaml.'
      )
    );
    return;
  }

  console.log('');
  const scaffResp = await prompts(
    {
      type: 'select',
      name: 'scaffolding',
      message: '¿Qué estilo de transformación aplicar?',
      choices,
      initial: 0,
    },
    promptsConfig
  );

  if (!scaffResp.scaffolding) {
    throw new Error('Operación cancelada por el usuario');
  }

  const scaffoldingName = scaffResp.scaffolding;

  // 4. Archivo de salida
  const defaultOutput = inputResp.inputPath.replace(
    /\.(yaml|yml|json)$/,
    `-${scaffoldingName}$&`
  );

  const outputResp = await prompts(
    {
      type: 'text',
      name: 'outputPath',
      message: 'Archivo de salida (transformado)',
      initial: defaultOutput,
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!outputResp.outputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  // 5. Ejecutar transformación
  console.log(styles.info('Aplicando transformaciones...'));

  const result = transform(openapi, {
    scaffolding: scaffoldingName,
    namingConfig: configs.modularize?.naming,
  });

  // 6. Escribir archivo transformado
  writeYamlFile(outputResp.outputPath, result.openapi, {
    indent: configs.modularize?.advanced?.indent || 2,
  });

  // 7. Mostrar resumen
  console.log('');
  console.log(styles.section('  RESUMEN DE TRANSFORMACIONES'));
  console.log(styles.divider());
  console.log(styles.info(`Schemas clasificados: ${result.stats.schemasClassified}`));
  console.log(styles.info(`Responses extraídos: ${result.stats.responsesExtracted}`));
  console.log(styles.info(`Responses normalizados: ${result.stats.responsesNormalized}`));

  printResult(`Archivo transformado: ${outputResp.outputPath}`, 'success');
}

// ---------------------------------------------------------------
// ACCIÓN 4: DOCUMENTACIÓN
// ---------------------------------------------------------------

async function actionDocs() {
  console.log('\n' + styles.divider());
  console.log(styles.section('  GENERAR DOCUMENTACIÓN'));
  console.log(styles.divider());

  const inputResp = await prompts(
    {
      type: 'text',
      name: 'inputPath',
      message: 'Archivo OAS3.x de entrada (Bundle recomendado)',
      initial: C.bundleOutput || './dist/bundle.yaml',
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!inputResp.inputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  const outputResp = await prompts(
    {
      type: 'text',
      name: 'outputPath',
      message: 'Ruta de salida del Markdown',
      initial: C.docsOutput || './docs/api.md',
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!outputResp.outputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  await generateMarkdownDocs(inputResp.inputPath, outputResp.outputPath);
  printResult(`Documentación generada: ${outputResp.outputPath}`, 'success');
}

// ---------------------------------------------------------------
// ACCIÓN 5: EXPORTAR SWAGGER 2.0
// ---------------------------------------------------------------

async function actionExportSwagger2() {
  console.log('\n' + styles.divider());
  console.log(styles.section('  EXPORTAR A SWAGGER 2.0'));
  console.log(styles.divider());

  const exampleInput = C.swagger2Input || C.bundleOutput || './dist/bundle.yaml';

  const inputResp = await prompts(
    {
      type: 'text',
      name: 'inputPath',
      message: 'Bundle OAS3.x de entrada',
      initial: exampleInput,
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!inputResp.inputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  const suggestedOutput =
    C.swagger2Output || buildDefaultSwagger2Output(inputResp.inputPath);

  const outputResp = await prompts(
    {
      type: 'text',
      name: 'outputPath',
      message: 'Ruta de salida de Swagger 2.0',
      initial: suggestedOutput || './dist/swagger2.yaml',
      validate: (v) => v.trim() !== '' || 'La ruta no puede estar vacía',
    },
    promptsConfig
  );

  if (!outputResp.outputPath) {
    throw new Error('Operación cancelada por el usuario');
  }

  await downgradeToSwagger2(inputResp.inputPath, outputResp.outputPath);
  printResult(`Swagger 2.0 generado: ${outputResp.outputPath}`, 'success');
}

// ---------------------------------------------------------------
// MENÚ PRINCIPAL
// ---------------------------------------------------------------

const MENU_ACTIONS = [
  {
    id: 1,
    label: 'Modularizar OAS3.x',
    description: 'Detecta estilo, selecciona scaffolding y divide en archivos',
    action: actionModularize,
  },
  {
    id: 2,
    label: 'Transformar OAS3.x',
    description: 'Aplica transformaciones de nombres sin modularizar',
    action: actionTransform,
  },
  {
    id: 3,
    label: 'Consolidar OAS3.x',
    description: 'Resuelve referencias y une todos los archivos en un Bundle',
    action: actionBundle,
  },
  {
    id: 4,
    label: 'Generar Documentación',
    description: 'Genera documentación Markdown desde el Bundle',
    action: actionDocs,
  },
  {
    id: 5,
    label: 'Exportar a Swagger 2.0',
    description: 'Convierte OAS3.x a Swagger 2.0 (downgrade)',
    action: actionExportSwagger2,
  },
];

async function showMenu() {
  // 👇 No limpiamos la consola: se mantiene todo el historial
  let version;
  try {
    version = getVersionDisplay();
  } catch {
    version = 'v?.?.?';
  }

  console.log('\n' + styles.divider());
  console.log(styles.header(`  OpenAPI Builder ${version}`));
  console.log(styles.divider() + '\n');

  console.log(chalk.bold('Selecciona una acción:\n'));

  MENU_ACTIONS.forEach((action) => {
    console.log(chalk.cyan(`  ${action.id}) ${action.label}`));
    console.log(styles.help(`     ${action.description}`));
  });
  console.log(styles.help(`\n  Presiona ESC o Ctrl+C para salir\n`));

  const response = await prompts(
    {
      type: 'number',
      name: 'action',
      message: 'Ingresa el número de la acción',
      initial: 1,
      validate: (v) => {
        if (isNaN(v) || v < 1 || v > MENU_ACTIONS.length) {
          return `Ingresa un número entre 1 y ${MENU_ACTIONS.length}`;
        }
        return true;
      },
    },
    {
      onCancel: () => {
        console.log('\n' + styles.header('👋 ¡Hasta luego!'));
        console.log(styles.divider() + '\n');
        process.exit(0);
      },
    }
  );

  if (response.action === undefined) {
    console.log('\n' + styles.header('👋 ¡Hasta luego!'));
    console.log(styles.divider() + '\n');
    process.exit(0);
  }

  const selectedAction = MENU_ACTIONS.find((a) => a.id === response.action);

  if (selectedAction) {
    try {
      await selectedAction.action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      printResult(message, 'error');
    }
  }

  await pause();
  await showMenu();
}

async function startApplication() {
  try {
    await showMenu();
  } catch (error) {
    console.error(styles.error(String(error)));
    process.exit(1);
  }
}

module.exports = {
  showMenu,
  startApplication,
};
