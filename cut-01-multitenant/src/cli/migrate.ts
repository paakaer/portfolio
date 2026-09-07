import { db } from '../index'

const applied = await db.migrate()
if (applied.length === 0) {
  console.log('migrations: up to date')
} else {
  console.log(`migrations: applied ${applied.length}`)
  for (const name of applied) console.log(`  + ${name}`)
}
await db.end()
