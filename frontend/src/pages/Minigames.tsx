import NavButtons from "../components/NavButtons";
import { useNavigate } from "react-router-dom";
import { Ear, ArrowRight, List, ALargeSmall, Languages, Image, Lightbulb, ScrollText } from "lucide-react";
import image0 from "../resources/images/0.jpg";
import image1 from "../resources/images/1.jpg";
import image2 from "../resources/images/2.jpg";
import image3 from "../resources/images/3.jpg";
import image4 from "../resources/images/4.jpg";
import image5 from "../resources/images/5.jpg";
import image6 from "../resources/images/6.jpg";
import image7 from "../resources/images/7.jpg";
import image8 from "../resources/images/8.jpg";
import image9 from "../resources/images/9.jpg";
import image10 from "../resources/images/10.jpg";
import image11 from "../resources/images/11.jpg";
import image12 from "../resources/images/12.jpg";
import image13 from "../resources/images/13.jpg";
import image14 from "../resources/images/14.jpg";
import image15 from "../resources/images/15.jpg";
import image16 from "../resources/images/16.jpg";
import image17 from "../resources/images/17.jpg";

const games = [
    {
        id: 0,
        title: "Recognition: Given Foreign Word Pick English Word From List",
        image: image0,
        input1: "languages",
        input2: "idea",
        output1: "aLargeSmall",
        output2: "list",
        link: "/minigames/foreignWordPickEnglishList",
    },
    {
        id: 1,
        title: "Recognition: Given English Word Pick Foreign Word From List",
        image: image1,
        input1: "aLargeSmall",
        input2: "idea",
        output1: "languages",
        output2: "list",
        link: "/minigames/englishWordPickForeignList",
    },
    {
        id: 2,
        title: "Recognition: Given Image Pick Foreign Word From List",
        image: image2,
        input1: "image",
        input2: "",
        output1: "languages",
        output2: "list",
        link: "/minigames/imagePickForeignList",
    },
    {
        id: 3,
        title: "Recognition: Listen To Foreign Word Pick Foreign Word From List",
        image: image3,
        input1: "languages",
        input2: "ear",
        output1: "languages",
        output2: "list",
        link: "/minigames/listenForeignWordPickForeignList",
    },
    {
        id: 4,
        title: "Recognition: Listen To Foreign Word Pick English Word From List",
        image: image4,
        input1: "languages",
        input2: "ear",
        output1: "aLargeSmall",
        output2: "list",
        link: "/minigames/listenForeignWordPickEnglishList",
    },
    {
        id: 5,
        title: "Recognition: Listen To English Word Pick Foreign Word From List",
        image: image5,
        input1: "aLargeSmall",
        input2: "ear",
        output1: "languages",
        output2: "list",
        link: "/minigames/listenEnglishWordPickForeignList",
    },
    {
        id: 6,
        title: "Recall: Given Foreign Word Type English Word",
        image: image6,
        input1: "languages",
        input2: "languages",
        output1: "aLargeSmall",
        output2: "idea",
        link: "/minigames/foreignWordTypeEnglishWord",
    },
    {
        id: 7,
        title: "Recall: Given English Word Type Foreign Word",
        image: image7,
        input1: "aLargeSmall",
        input2: "languages",
        output1: "languages",
        output2: "idea",
        link: "/minigames/englishWordTypeForeignWord",
    },
    {
        id: 8,
        title: "Recall: Given Image Type Foreign Word",
        image: image8,
        input1: "image",
        input2: "",
        output1: "languages",
        output2: "idea",
        link: "/minigames/imageTypeForeignWord",
    },
    {
        id: 9,
        title: "Recall: Listen To Foreign Word Type Foreign Word",
        image: image9,
        input1: "languages",
        input2: "ear",
        output1: "languages",
        output2: "idea",
        link: "/minigames/listenForeignWordTypeForeignWord",
    },
    {
        id: 10,
        title: "Recall: Listen To Foreign Word Type English Word",
        image: image10,
        input1: "languages",
        input2: "ear",
        output1: "aLargeSmall",
        output2: "idea",
        link: "/minigames/listenForeignWordTypeEnglishWord",
    },
    {
        id: 11,
        title: "Recall: Listen To English Word Type Foreign Word",
        image: image11,
        input1: "aLargeSmall",
        input2: "ear",
        output1: "languages",
        output2: "idea",
        link: "/minigames/listenEnglishWordTypeForeignWord",
    },
    {
        id: 12,
        title: "Recite: Given Foreign Sentence Type Foreign Sentence",
        image: image12,
        input1: "languages",
        input2: "sentence",
        output1: "languages",
        output2: "sentence",
        link: "/minigames/foreignSentenceTypeForeignSentence",
    },
    {
        id: 13,
        title: "Recite: Listen To Foreign Sentence Type Foreign Sentence",
        image: image13,
        input1: "languages",
        input2: "ear",
        output1: "languages",
        output2: "sentence",
        link: "/minigames/listenForeignSentenceTypeForeignSentence",
    },
    {
        id: 14,
        title: "Given Foreign Sentence Type English Sentence",
        image: image14,
        input1: "languages",
        input2: "sentence",
        output1: "aLargeSmall",
        output2: "sentence",
        link: "/minigames/foreignSentenceTypeEnglishSentence",
    },
    {
        id: 15,
        title: "Given English Sentence Type Foreign Sentence",
        image: image15,
        input1: "aLargeSmall",
        input2: "sentence",
        output1: "languages",
        output2: "sentence",
        link: "/minigames/englishSentenceTypeForeignSentence",
    },
    {
        id: 16,
        title: "Listen To Foreign Sentence Type English Sentence",
        image: image16,
        input1: "languages",
        input2: "ear",
        output1: "aLargeSmall",
        output2: "sentence",
        link: "/minigames/listenForeignSentenceTypeEnglishSentence",
    },
    {
        id: 17,
        title: "Listen To English Sentence Type Foreign Sentence",
        image: image17,
        input1: "aLargeSmall",
        input2: "ear",
        output1: "languages",
        output2: "sentence",
        link: "/minigames/listenEnglishSentenceTypeForeignSentence",
    },
];

export default function MiniGames() {
    const navigate = useNavigate();
    return (
        <div className="page">
            <NavButtons />

            <h1 className="page-title">Mini Games</h1>

            <div className="games-grid">
                {games.map((game) => (
                    <div className="game-card" onClick={() => navigate(game.link)}>
                        <div className="game-image">
                            <img src={game.image} alt={game.title} />
                            <div className="game-overlay">
                                {game.input1 == "languages" && <Languages className="icon" />}
                                {game.input1 == "aLargeSmall" && <ALargeSmall className="icon" />}
                                {game.input1 == "image" && <Image className="icon" />}
                                {game.input2 == "ear" && <Ear className="icon" />}
                                {game.input2 == "idea" && <Lightbulb className="icon" />}
                                {game.input2 == "sentence" && <ScrollText className="icon" />}
                                <ArrowRight className="icon arrow" />
                                {game.output1 == "languages" && <Languages className="icon" />}
                                {game.output1 == "aLargeSmall" && <ALargeSmall className="icon" />}
                                {game.output2 == "list" && <List className="icon" />}
                                {game.output2 == "idea" && <Lightbulb className="icon" />}
                                {game.output2 == "sentence" && <ScrollText className="icon" />}
                            </div>
                        </div>

                        <h2>{game.title}</h2>
                    </div>
                ))}
            </div>
        </div>
    );
}