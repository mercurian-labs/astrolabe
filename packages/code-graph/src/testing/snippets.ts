/** Small sources, one per language, that exercise every tag and import the index reads. */
export const TS_SNIPPET = `import { helper } from "./util.ts";
import * as Lib from "./lib.ts";

export interface Shape {
  area(): number;
}

export class Base {}

export class Square extends Base implements Shape {
  area(): number {
    return helper(2);
  }
}

export function build() {
  return new Square();
}

export const SIDES = 4;

Lib.run();
`;

export const PY_SNIPPET = `from .io import InputOutput
import os.path


class Coder(Base):
    def run(self):
        self.send()
        InputOutput()

    def send(self):
        pass


def main():
    Coder().run()


LIMIT = 3
`;

export const GO_SNIPPET = `package server

import (
	"fmt"
	st "example.com/app/store"
)

type Handler interface {
	Serve()
}

type Server struct {
	name string
}

func (s *Server) Serve() {
	fmt.Println(s.name)
	st.Open()
}

func New() *Server {
	return &Server{}
}
`;

export const RS_SNIPPET = `use crate::shapes::Shape;

pub struct Circle {
    r: f64,
}

impl Shape for Circle {
    fn area(&self) -> f64 {
        helper(self.r)
    }
}

impl Circle {
    pub fn new(r: f64) -> Self {
        Circle { r }
    }
}

fn helper(x: f64) -> f64 {
    x
}

fn main() {
    let c = Circle::new(1.0);
    c.area();
}
`;
