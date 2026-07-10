import { useEffect, useState } from "react";
import axios from "axios";


const API =
  import.meta.env.VITE_API_URL || "http://localhost:3000";



export default function App() {


  const [games, setGames] = useState([]);

  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");




  async function loadGames(){


    try {


      setLoading(true);

      setError("");



      const response =
        await axios.get(
          `${API}/games`
        );



      setGames(
        response.data
      );



    } catch(error){


      console.log(
        "Erro carregando jogos:",
        error
      );


      setError(
        "Não foi possível conectar ao servidor."
      );



    } finally {


      setLoading(false);


    }


  }





  async function playGame(id){


    try {


      await axios.post(

        `${API}/play`,

        {
          id
        }

      );



    } catch(error){


      console.log(
        "Erro iniciando jogo:",
        error
      );


    }


  }






  async function refreshGames(){


    try {


      await axios.post(
        `${API}/refresh`
      );


      loadGames();



    } catch(error){


      console.log(
        "Erro atualizando biblioteca:",
        error
      );


    }


  }






  useEffect(()=>{


    loadGames();


  },[]);






  const filteredGames =

    games.filter(game =>


      game.name

        .toLowerCase()

        .includes(

          search.toLowerCase()

        )


    );







  return (


    <div className="container">



      <header>



        <h1>
          🎮 Game Launcher
        </h1>




        <div className="actions">



          <input


            placeholder="Pesquisar jogo..."


            value={search}


            onChange={

              e =>

                setSearch(
                  e.target.value
                )

            }


          />



          <button

            onClick={refreshGames}

          >

            🔄 Atualizar

          </button>



        </div>



      </header>





      {

        loading &&


        <h2>
          Carregando jogos...
        </h2>


      }






      {

        error &&


        <h2>
          {error}
        </h2>


      }







      {

        !loading && !error && (



          <div className="grid">



            {


              filteredGames.length === 0 ?


              <h2>
                Nenhum jogo encontrado
              </h2>



              :



              filteredGames.map(game => (




                <div

                  className="card"

                  key={game.id}

                >





                  {


                    game.cover ?



                    <img


                      src={
                        `${API}/covers/${game.cover}`
                      }


                      alt={
                        game.name
                      }


                    />



                    :



                    <div className="no-cover">

                      🎮

                    </div>



                  }







                  <div className="info">



                    <h2>
                      {game.name}
                    </h2>





                    <button


                      onClick={() =>
                        playGame(game.id)
                      }


                    >

                      ▶ Jogar


                    </button>




                  </div>





                </div>



              ))



            }



          </div>



        )


      }





    </div>


  );


}