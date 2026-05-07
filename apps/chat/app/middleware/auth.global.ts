export default defineNuxtRouteMiddleware((to) => {
  const { status } = useAuth()
  if (status.value === 'loading') return
  if (status.value === 'unauthenticated' && to.path !== '/login') {
    return navigateTo('/login')
  }
})
