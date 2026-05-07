import { NuxtAuthHandler } from '#auth'
import type { GitLabProfile } from 'next-auth/providers/gitlab'
import _GitLabProvider from 'next-auth/providers/gitlab'

// next-auth/providers/gitlab est un module CJS : dans un contexte ESM (Nitro),
// l'import default est l'objet module — la factory est sur .default.
const GitLabProvider = (_GitLabProvider as unknown as { default: typeof _GitLabProvider }).default

// URL publique (navigateur) : utilisée pour la redirection d'autorisation OAuth
const gitlabPublicUrl = process.env.NUXT_GITLAB_URL ?? 'http://localhost'
// URL interne (serveur) : utilisée pour l'échange de code et les appels userinfo
// En Docker, GitLab est joignable via son hostname réseau, pas via localhost.
const gitlabInternalUrl = process.env.NUXT_GITLAB_INTERNAL_URL ?? gitlabPublicUrl

export default NuxtAuthHandler({
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token as string
      }
      return token
    },
  },
  providers: [
    GitLabProvider({
      clientId: process.env.NUXT_GITLAB_CLIENT_ID!,
      clientSecret: process.env.NUXT_GITLAB_CLIENT_SECRET!,
      authorization: {
        url: `${gitlabPublicUrl}/oauth/authorize`,
        params: { scope: 'read_user read_api', response_type: 'code' },
      },
      token: `${gitlabInternalUrl}/oauth/token`,
      userinfo: {
        url: `${gitlabInternalUrl}/api/v4/user`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async request(context: any) {
          return fetch(context.provider.userinfo.url as string, {
            headers: { Authorization: `Bearer ${context.tokens.access_token as string}` },
          }).then(r => r.json())
        },
      },
      profile(profile: GitLabProfile) {
        return {
          id: String(profile.id),
          name: profile.name,
          email: profile.email ?? null,
          image: profile.avatar_url ?? null,
        }
      },
    }),
  ],
})
