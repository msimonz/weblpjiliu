import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { query, pool } from './db.js'

async function cambiarPasswordATodos() {
  const { rows: users } = await query('SELECT id, email FROM auth.users')

  const hash = bcrypt.hashSync('123456', 10)

  for (const user of users) {
    try {
      await query('UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2', [hash, user.id])
      console.log(`Password actualizada: ${user.email || user.id}`)
    } catch (e) {
      console.error(`Error actualizando ${user.email || user.id}:`, e.message)
    }
  }

  console.log('Proceso terminado')
  await pool.end()
}

cambiarPasswordATodos()
