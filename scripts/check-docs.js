#!/usr/bin/env node

/**
 * Documentation Check Script
 * 
 * Checks if code files have changed and reminds developer to update documentation.
 * This script is run as part of the pre-commit hook to ensure documentation stays in sync.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const DOC_FILES = [
  'README.md',
  'SETUP.md',
  'ARCHITECTURE.md',
  'STATUS.md',
  'IMPLEMENTATION.md',
];

const CODE_PATTERNS = [
  'src/**/*.ts',
  'src/**/*.js',
  'scripts/**/*.ts',
  'scripts/**/*.js',
];

const IGNORE_PATTERNS = [
  'dist/',
  'node_modules/',
  '*.d.ts',
  '*.js.map',
];

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error getting staged files:', error.message);
    return [];
  }
}

function isCodeFile(file) {
  return CODE_PATTERNS.some((pattern) => {
    const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
    return regex.test(file);
  });
}

function isDocFile(file) {
  return DOC_FILES.includes(file);
}

function shouldIgnoreFile(file) {
  return IGNORE_PATTERNS.some((pattern) => {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return regex.test(file);
  });
}

function checkDocumentation() {
  const stagedFiles = getStagedFiles();
  
  if (stagedFiles.length === 0) {
    console.log('✅ No staged files to check.');
    return true;
  }

  const codeFiles = stagedFiles.filter(
    (file) => isCodeFile(file) && !shouldIgnoreFile(file)
  );
  const docFiles = stagedFiles.filter((file) => isDocFile(file));

  if (codeFiles.length === 0) {
    console.log('✅ No code files changed, documentation check skipped.');
    return true;
  }

  console.log('\n📝 Documentation Check');
  console.log('='.repeat(50));
  console.log(`\n🔍 Found ${codeFiles.length} code file(s) changed:`);
  codeFiles.forEach((file) => console.log(`   - ${file}`));

  if (docFiles.length > 0) {
    console.log(`\n✅ Found ${docFiles.length} documentation file(s) updated:`);
    docFiles.forEach((file) => console.log(`   - ${file}`));
    console.log('\n✅ Documentation appears to be updated!');
    return true;
  }

  console.log('\n⚠️  WARNING: Code files changed but no documentation files updated!');
  console.log('\n📋 Documentation files that may need updating:');
  DOC_FILES.forEach((doc) => console.log(`   - ${doc}`));
  console.log('\n❌ COMMIT BLOCKED: Please update documentation before committing.');
  console.log('\n💡 Tips:');
  console.log('   - Review changed code and update relevant documentation');
  console.log('   - Update README.md for user-facing changes');
  console.log('   - Update ARCHITECTURE.md for architectural changes');
  console.log('   - Update SETUP.md for setup/configuration changes');
  console.log('   - Update STATUS.md for implementation status');
  console.log('   - Update IMPLEMENTATION.md for implementation details');
  console.log('\n💡 To bypass this check (not recommended):');
  console.log('   git commit --no-verify\n');

  return false;
}

// Run check
const passed = checkDocumentation();
process.exit(passed ? 0 : 1);

