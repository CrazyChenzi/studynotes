export default {
  base: '/studynotes/',
  title: 'StudyNotes',
  description: `CrazyChenzi's study notes, unlike blogs, are essays, only about code`,
  themeConfig: {
    displayAllHeaders: true,
    sidebar: [
      {
        title: 'Vue3.0 源码阅读',
        link: '/vueSourceCode/',
        children: [
          '/vueSourceCode/Vue3 Compiler 优化细节.md',
          '/vueSourceCode/从 compile 和 runtime 来看组件的第一次 patch.md',
          // '/vueSourceCode/从 patch 方法来看 diff 算法.md',
          '/vueSourceCode/Vue3 源码解读之 teleport.md',
        ]
      },
    ],
    logo: '/imgs/鸡尾酒.svg',
    nav: [
      // { text: 'Home', link: '/' },
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
