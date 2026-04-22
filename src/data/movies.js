// data/movies.js

export const movies = {
  featured: {
    title: "Inception",
    description: "Dream within a dream",
    genre: ["Sci-Fi", "Action", "Thriller"],
    rating: "PG-13",
    status: "featured",
    releaseDate: "2010-07-16",
    duration: "2h 28m",
    posterUrl: "https://image.tmdb.org/t/p/w500/8IB2e4r4oVhHnANbnm7O3Tj6tF8.jpg",
    cast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page", "Tom Hardy"],
    trailerUrl: "https://www.youtube.com/watch?v=YoHD9XEInc0"
  },
  nowShowing: [
    {
      title: "Interstellar",
      description: "Space travel",
      genre: ["Sci-Fi", "Adventure", "Drama"],
      rating: "PG-13",
      status: "nowShowing",
      releaseDate: "2014-11-07",
      duration: "2h 49m",
      posterUrl: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
      cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain"],
      trailerUrl: "https://www.youtube.com/watch?v=zSWdZVtXT7E"
    }
  ],
  comingSoon: [
    {
      title: "Dune: Part Two",
      description: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.",
      genre: ["Sci-Fi", "Adventure"],
      rating: "PG-13",
      status: "comingSoon",
      releaseDate: "2024-03-01",
      duration: "2h 46m",
      posterUrl: "https://image.tmdb.org/t/p/w500/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg",
      cast: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson"],
      trailerUrl: "https://www.youtube.com/watch?v=Way9Dexny3w"
    }
  ]
};