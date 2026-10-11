# term: the user's .zprofile, from their real ZDOTDIR (see .zshenv).
ZDOTDIR=$__bro_term_user_zdotdir
[[ -r $ZDOTDIR/.zprofile ]] && source $ZDOTDIR/.zprofile
__bro_term_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__bro_term_zdotdir
