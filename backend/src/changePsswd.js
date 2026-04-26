import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function cambiarPasswordATodos() {
  let page = 1
  const perPage = 100

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })

    if (error) {
      console.error('Error listando usuarios:', error.message)
      return
    }

    const users = data?.users || []
    if (users.length === 0) break

    for (const user of users) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        user.id,
        { password: '123456' }
      )

      if (updateError) {
        console.error(`Error actualizando ${user.email || user.id}:`, updateError.message)
      } else {
        console.log(`Password actualizada: ${user.email || user.id}`)
      }
    }

    page++
  }

  console.log('Proceso terminado')
}

cambiarPasswordATodos()