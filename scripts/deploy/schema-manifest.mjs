import * as schema from '../../dist/role-eval/schema-migrations.js';
import {readPerformanceMigration} from '../../dist/role-eval/performance-open.js';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
process.stdout.write(JSON.stringify([[7,hash(readPerformanceMigration())],...[8,9,10,11].map(v=>[v,hash(schema[`MIGRATION_${String(v).padStart(3,'0')}_SQL`])])])+'\n');
