export default {
  base: '/',
  title: 'StudyNotes',
  description: `CrazyChenzi's study notes, unlike blogs, are essays, only about code`,
  themeConfig: {
    sidebar: 'auto',
    logo: '/imgs/鸡尾酒.svg',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'External', link: 'https://google.com' },
    ],
  },

  head: [
    [
      'link',
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: `/imgs/鸡尾酒.png`,
      },
    ],
  ],
}
